"""
VoiceMorph FastAPI Server.

Main HTTP/WebSocket application entry point. Coordinates:
1. Dual-engine AI and Fast-DSP voice conversion worker threads.
2. Two-way full-duplex audio routing between Mobile Client and Target PC Virtual Mic.
3. Proxy bridge for Target PC desktop and call audio (Discord/WhatsApp) downlink.
"""

import os
import sys
import json
import asyncio
import logging
from contextlib import asynccontextmanager

import numpy as np
import soundfile as sf
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Add parent directory to path to enable package imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.config import (
    routing_config,
    get_local_ip,
    get_ssl_kwargs,
    INPUT_SAMPLE_RATE,
    MIN_AUDIO_BYTES,
    DEFAULT_SERVER_PORT
)
from server.target_client import check_target_pc, forward_to_target_pc
from server.voice_engine import VoiceEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("VoiceServer")

# Global singleton voice conversion engine
engine: VoiceEngine = None


def get_engine() -> VoiceEngine:
    """Lazily initializes and returns the singleton VoiceEngine."""
    global engine
    if engine is None:
        logger.info("Initializing Voice Engine...")
        engine = VoiceEngine()
    return engine


# ==========================================
# 1. Application Lifespan & Initialization
# ==========================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initializes models on startup and prints network connectivity banner."""
    get_engine()
    local_ip = get_local_ip()
    port = DEFAULT_SERVER_PORT

    print("\n" + "=" * 65)
    print(" 🎙️  VOICEMORPH DUAL-ENGINE SERVER READY (HTTPS)!")
    print(f" 💻  PC Web Interface:   https://localhost:{port}")
    print(f" 📱  Mobile Web App:     https://{local_ip}:{port}")
    print(" 🔒  Secure Context Active: Mobile microphone fully unlocked!")
    print("     (Tap 'Advanced' -> 'Proceed to 192.168.1.X')")
    print("=" * 65 + "\n")
    yield


app = FastAPI(title="VoiceMorph Mobile Voice Changer Server", lifespan=lifespan)

# Allow CORS for mobile web apps on local Wi-Fi
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_no_cache_header(request, call_next):
    """Disables aggressive browser caching on source assets so updates load instantly."""
    response = await call_next(request)
    if request.url.path.endswith((".js", ".html", ".css")) or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# ==========================================
# 2. REST API Endpoints
# ==========================================

@app.post("/api/client_debug_log")
async def client_debug_log(payload: dict):
    """Receives remote browser console logs from mobile devices for diagnostics."""
    logger.info(f"📱 [CLIENT LOG]: {json.dumps(payload)}")
    return {"status": "ok"}


@app.get("/api/target_pc/verify")
async def api_verify_target(ip: str = "127.0.0.1", port: int = 8001):
    """HTTP REST fallback to verify Target PC Virtual Mic receiver health."""
    ok, info = await asyncio.to_thread(check_target_pc, ip, port)
    return {"success": ok, "details": info, "ip": ip, "port": port}


@app.get("/api/routing")
async def get_routing():
    """Returns current audio destination routing configuration."""
    return routing_config


@app.post("/api/routing")
async def set_routing(data: dict):
    """Updates audio destination configuration (Target PC vs Mobile Speaker)."""
    if "target_pc_ip" in data:
        routing_config["target_pc_ip"] = str(data["target_pc_ip"])
    if "target_pc_port" in data:
        routing_config["target_pc_port"] = int(data["target_pc_port"])
    if "target_pc_enabled" in data:
        routing_config["target_pc_enabled"] = bool(data["target_pc_enabled"])
    if "mobile_speaker_enabled" in data:
        routing_config["mobile_speaker_enabled"] = bool(data["mobile_speaker_enabled"])
    return routing_config


@app.get("/api/info")
async def get_info():
    """Returns system status, active voice model, and runtime audio settings."""
    eng = get_engine()
    return {
        "status": "ready" if eng else "loading",
        "local_ip": get_local_ip(),
        "current_model": eng.current_tag if eng else None,
        "pitch_lvl": eng.pitch_lvl if eng else 12,
        "pitch_algo": eng.pitch_algo if eng else "pm",
        "denoise_mode": eng.denoise_mode if eng else "high",
        "available_models": list(eng.available_models.keys()) if eng else [],
        "routing": routing_config
    }


@app.post("/api/config")
async def set_config(data: dict):
    """Updates model parameters (pitch shift, voice weights, denoiser mode)."""
    eng = get_engine()
    if not eng:
        return JSONResponse({"error": "Engine not initialized"}, status_code=500)

    model_name = data.get("model", eng.current_tag)
    pitch_lvl = data.get("pitch", eng.pitch_lvl)
    pitch_algo = data.get("algo", eng.pitch_algo)
    index_influence = data.get("index_influence", eng.index_influence)
    if "volume" in data:
        eng.volume_gain = float(data["volume"])
    if "denoise" in data:
        eng.set_denoise_mode(data["denoise"])

    result = eng.load_voice(
        model_name=model_name,
        pitch_lvl=pitch_lvl,
        pitch_algo=pitch_algo,
        index_influence=index_influence
    )
    result["volume_gain"] = eng.volume_gain
    result["denoise_mode"] = eng.denoise_mode
    return result


# ==========================================
# 3. Main Voice Conversion WebSocket (/ws)
# ==========================================

@app.websocket("/ws")
async def websocket_audio(websocket: WebSocket):
    """
    Main full-duplex audio conversion channel.
    Receives raw 16kHz PCM audio, converts through VoiceEngine on CPU worker thread,
    and forwards to Target PC virtual mic or mobile phone.
    """
    await websocket.accept()
    logger.info("Mobile client connected via WebSocket!")
    eng = get_engine()

    # Welcome handshake payload
    await websocket.send_json({
        "type": "connected",
        "current_model": eng.current_tag,
        "pitch_lvl": eng.pitch_lvl,
        "engine_mode": eng.engine_mode,
        "volume_gain": eng.volume_gain,
        "denoise_mode": eng.denoise_mode,
        "available_models": list(eng.available_models.keys()),
        "vocal_profile": eng.vocal_profile,
        "calibrated_env": eng.calibrated_env,
        "calibrated_noise_db": eng.calibrated_noise_db,
        "routing": routing_config
    })

    # Non-blocking audio processing queue
    conversion_queue = asyncio.Queue()
    is_active = True

    async def worker():
        """Dedicated coroutine worker preventing audio conversion from blocking WebSocket loop."""
        while is_active:
            try:
                item = await conversion_queue.get()
                if item is None:
                    break
                audio_np = item
                audio_dur = len(audio_np) / float(INPUT_SAMPLE_RATE)

                logger.info(f"🎙️ [Worker] Processing {audio_dur:.2f}s of speech on Ryzen CPU...")
                await websocket.send_json({
                    "type": "progress",
                    "step": "converting",
                    "msg": f"AI is converting your voice ({audio_dur:.1f}s speech)..."
                })

                converted_bytes, out_sr, proc_time = await asyncio.to_thread(
                    eng.convert_audio_array, audio_np, INPUT_SAMPLE_RATE
                )

                target_enabled = routing_config.get("target_pc_enabled", False)
                mobile_enabled = routing_config.get("mobile_speaker_enabled", True)
                target_ip = routing_config.get("target_pc_ip", "127.0.0.1")
                target_port = routing_config.get("target_pc_port", 8001)

                if target_enabled:
                    # Dispatch to Target PC virtual microphone asynchronously
                    asyncio.create_task(forward_to_target_pc(converted_bytes, out_sr, target_ip, target_port))

                logger.info(f"✨ [Worker] Done in {proc_time:.2f}s! TargetPC={target_enabled}, MobileSpeaker={mobile_enabled}")
                await websocket.send_json({
                    "type": "audio_chunk",
                    "sample_rate": out_sr,
                    "duration_sec": audio_dur,
                    "proc_time_sec": round(proc_time, 2),
                    "bytes_len": len(converted_bytes),
                    "target_pc_enabled": target_enabled,
                    "mobile_speaker_enabled": mobile_enabled
                })

                if mobile_enabled:
                    await websocket.send_bytes(converted_bytes)
                    logger.info("📡 [Worker] Audio stream delivered to phone!")
                else:
                    logger.info("🔇 [Worker] Audio delivered to Target PC only (Mobile playback muted).")
                conversion_queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in conversion worker: {e}")
                try:
                    await websocket.send_json({"type": "error", "msg": str(e)})
                except Exception:
                    pass

    worker_task = asyncio.create_task(worker())

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                logger.info("Mobile client disconnected normally.")
                break

            # 1. Text / JSON messages (control events)
            if "text" in message:
                try:
                    payload = json.loads(message["text"])
                    action = payload.get("action")

                    if action == "client_log":
                        logger.info(f"📱 [Mobile]: {payload.get('msg')}")
                        continue

                    if action == "set_engine_mode":
                        new_mode = payload.get("mode", "dsp")
                        eng.engine_mode = new_mode
                        logger.info(f"Engine mode switched to: '{new_mode}'")
                        await websocket.send_json({
                            "type": "mode_updated",
                            "engine_mode": new_mode
                        })
                        continue

                    if action == "set_vocal_profile":
                        new_prof = payload.get("profile", "standard")
                        eng.set_vocal_profile(new_prof)
                        await websocket.send_json({
                            "type": "vocal_profile_updated",
                            "vocal_profile": eng.vocal_profile
                        })
                        continue

                    if action == "calibrate_room":
                        noise_db = float(payload.get("noise_db", -60.0))
                        mode = payload.get("mode", "auto")
                        cal_env, cal_db = eng.set_room_calibration(noise_db, mode)
                        await websocket.send_json({
                            "type": "room_calibrated",
                            "calibrated_env": cal_env,
                            "calibrated_noise_db": cal_db,
                            "msg": f"Room calibrated: {cal_db:.1f} dB ({'Fan ON' if cal_env == 'fan_on' else 'Fan OFF / Quiet'} Mode)"
                        })
                        continue

                    if action == "set_config":
                        if "model" in payload and payload["model"] in eng.available_models:
                            eng.load_voice(model_name=payload["model"])
                        if "pitch" in payload:
                            eng.pitch_lvl = int(payload["pitch"])
                        if "algo" in payload:
                            eng.pitch_algo = str(payload["algo"])
                        if "volume" in payload:
                            eng.volume_gain = float(payload["volume"])
                            logger.info(f"🔊 Output volume boost set to: {eng.volume_gain * 100:.0f}% ({eng.volume_gain:.2f}x)")
                        if "denoise" in payload:
                            eng.set_denoise_mode(payload["denoise"])
                        await websocket.send_json({
                            "type": "config_updated",
                            "current_model": eng.current_tag,
                            "pitch_lvl": eng.pitch_lvl,
                            "pitch_algo": eng.pitch_algo,
                            "volume_gain": eng.volume_gain,
                            "denoise_mode": eng.denoise_mode
                        })
                        continue

                    if action == "ping":
                        # Fast pong reply (< 0.1ms) keeps connection hot
                        await websocket.send_json({"type": "pong", "time": payload.get("time")})

                    elif action == "verify_target_pc":
                        target_ip = payload.get("ip", routing_config["target_pc_ip"])
                        target_port = int(payload.get("port", routing_config["target_pc_port"]))
                        logger.info(f"🔍 Verifying Target PC at http://{target_ip}:{target_port}...")
                        ok, info = await asyncio.to_thread(check_target_pc, target_ip, target_port)
                        await websocket.send_json({
                            "type": "target_pc_status",
                            "success": ok,
                            "ip": target_ip,
                            "port": target_port,
                            "details": info
                        })

                    elif action == "update_routing":
                        if "target_pc_ip" in payload:
                            routing_config["target_pc_ip"] = str(payload["target_pc_ip"])
                        if "target_pc_port" in payload:
                            routing_config["target_pc_port"] = int(payload["target_pc_port"])
                        if "target_pc_enabled" in payload:
                            routing_config["target_pc_enabled"] = bool(payload["target_pc_enabled"])
                        if "mobile_speaker_enabled" in payload:
                            routing_config["mobile_speaker_enabled"] = bool(payload["mobile_speaker_enabled"])
                        logger.info(f"🔄 Routing updated: {routing_config}")
                        await websocket.send_json({
                            "type": "routing_updated",
                            "routing": routing_config
                        })
                except Exception as e:
                    logger.error(f"Error handling control message: {e}")

            # 2. Binary messages (raw 16kHz PCM audio from mobile microphone)
            elif "bytes" in message:
                raw_bytes = message["bytes"]
                audio_dur = len(raw_bytes) / (2 * float(INPUT_SAMPLE_RATE))

                if len(raw_bytes) < MIN_AUDIO_BYTES:
                    logger.warning(f"Audio chunk too short (<{MIN_AUDIO_BYTES} bytes), skipping.")
                    continue

                audio_np = np.frombuffer(raw_bytes, dtype=np.int16)
                try:
                    sf.write("calibration_voice_sample.wav", audio_np, INPUT_SAMPLE_RATE)
                except Exception as err:
                    logger.warning(f"Failed to save calibration sample: {err}")
                logger.info(f"📥 Received {len(raw_bytes)} bytes audio ({audio_dur:.2f}s). Queued for RVC CPU conversion...")
                await websocket.send_json({
                    "type": "progress",
                    "step": "queued",
                    "msg": "Audio received by server. Starting AI synthesis..."
                })
                await conversion_queue.put(audio_np)

    except WebSocketDisconnect:
        logger.info("Mobile client disconnected.")
    except Exception as e:
        logger.error(f"WebSocket session error: {e}")
    finally:
        is_active = False
        worker_task.cancel()


# ==========================================
# 4. Target PC Audio Downlink Proxy (/ws/pc_audio)
# ==========================================

@app.websocket("/ws/pc_audio")
async def websocket_pc_audio_proxy(client_ws: WebSocket):
    """
    Bridges live Target PC desktop/speaker audio (Discord/WhatsApp calls) to mobile phone.
    Acts as a lightweight transparent WebSocket proxy between phone and target_receiver.py.
    """
    await client_ws.accept()
    target_ip = routing_config.get("target_pc_ip", "127.0.0.1")
    target_port = routing_config.get("target_pc_port", 8001)
    target_url = f"ws://{target_ip}:{target_port}/pc_audio"

    logger.info(f"🎧 [PC Audio Proxy] Connecting to Target PC at {target_url}...")
    try:
        async with websockets.connect(target_url, ping_interval=10, ping_timeout=10) as target_ws:
            logger.info("🎧 [PC Audio Proxy] Bridge active! Streaming Target PC sound to phone...")

            async def forward_to_client():
                try:
                    async for chunk in target_ws:
                        if isinstance(chunk, str):
                            await client_ws.send_text(chunk)
                        else:
                            await client_ws.send_bytes(chunk)
                except Exception:
                    pass

            async def listen_client():
                try:
                    while True:
                        msg = await client_ws.receive()
                        if msg.get("type") == "websocket.disconnect":
                            break
                except Exception:
                    pass

            await asyncio.gather(forward_to_client(), listen_client(), return_exceptions=True)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"PC Audio proxy session ended: {e}")
    finally:
        logger.info("🎧 [PC Audio Proxy] Client disconnected.")


# ==========================================
# 5. Static Files & Entry Point
# ==========================================

client_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "client")
if os.path.exists(client_dir):
    app.mount("/", StaticFiles(directory=client_dir, html=True), name="client")

if __name__ == "__main__":
    import uvicorn
    ssl_kwargs = get_ssl_kwargs()
    uvicorn.run("server.main:app", host="0.0.0.0", port=DEFAULT_SERVER_PORT, reload=False, **ssl_kwargs)
