import os
import sys
import json
import socket
import asyncio
import logging
import numpy as np
import soundfile as sf
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.voice_engine import VoiceEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("VoiceServer")

from contextlib import asynccontextmanager
import base64
import urllib.request
import websockets

engine = None

routing_config = {
    "target_pc_ip": "127.0.0.1",
    "target_pc_port": 8001,
    "target_pc_enabled": True,
    "mobile_speaker_enabled": True
}

def check_target_pc(ip, port=8001):
    try:
        url = f"http://{ip}:{port}/status"
        req = urllib.request.Request(url, headers={"User-Agent": "VoiceMorphServer"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode())
                return True, data
    except Exception as e:
        return False, str(e)
    return False, "Unreachable"

async def forward_to_target_pc(pcm_bytes, sr, ip, port):
    try:
        b64 = base64.b64encode(pcm_bytes).decode("ascii")
        url = f"http://{ip}:{port}/audio"
        payload = json.dumps({"pcm_b64": b64, "sample_rate": sr}).encode("utf-8")
        
        def _post():
            req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                return resp.status
                
        status = await asyncio.to_thread(_post)
        logger.info(f"📡 [Target PC] Stream delivered to Virtual Mic on {ip}:{port} (HTTP {status})")
    except Exception as e:
        logger.warning(f"Could not forward audio to Target PC {ip}:{port}: {e}")

def get_engine():
    global engine
    if engine is None:
        logger.info("Initializing Voice Engine...")
        engine = VoiceEngine()
    return engine

def get_local_ip():
    """Detects local LAN IP to connect from mobile phone."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

@asynccontextmanager
async def lifespan(app: FastAPI):
    eng = get_engine()
    local_ip = get_local_ip()
    port = 8000
    print("\n" + "=" * 65)
    print(" 🎙️  RVC & FAST-DSP VOICE CHANGER READY (HTTPS)!")
    print(f" 💻  PC Web Interface:   https://localhost:{port}")
    print(f" 📱  Mobile Web App:     https://{local_ip}:{port}")
    print(" 🔒  Secure Context Active: Mobile microphone fully unlocked!")
    print("     (Tap 'Advanced' -> 'Proceed to 192.168.1.2')")
    print("=" * 65 + "\n")
    yield

app = FastAPI(title="RVC Mobile Voice Changer Server", lifespan=lifespan)

# Allow CORS for mobile browsers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_no_cache_header(request, call_next):
    response = await call_next(request)
    if request.url.path.endswith((".js", ".html", ".css")) or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

@app.post("/api/client_debug_log")
async def client_debug_log(payload: dict):
    logger.info(f"📱 [CLIENT LOG]: {json.dumps(payload)}")
    return {"status": "ok"}

@app.get("/api/target_pc/verify")
async def api_verify_target(ip: str = "127.0.0.1", port: int = 8001):
    ok, info = await asyncio.to_thread(check_target_pc, ip, port)
    return {"success": ok, "details": info, "ip": ip, "port": port}

@app.get("/api/routing")
async def get_routing():
    return routing_config

@app.post("/api/routing")
async def set_routing(data: dict):
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

@app.websocket("/ws")
async def websocket_audio(websocket: WebSocket):
    await websocket.accept()
    logger.info("Mobile client connected via WebSocket!")
    eng = get_engine()
    
    # Send welcome config
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
    
    # Non-blocking conversion queue
    conversion_queue = asyncio.Queue()
    is_active = True
    
    async def worker():
        while is_active:
            try:
                item = await conversion_queue.get()
                if item is None:
                    break
                audio_np = item
                audio_dur = len(audio_np) / 16000.0
                
                logger.info(f"🎙️ [Worker] Processing {audio_dur:.2f}s of speech on Ryzen CPU...")
                await websocket.send_json({
                    "type": "progress",
                    "step": "converting",
                    "msg": f"AI is converting your voice ({audio_dur:.1f}s speech)..."
                })
                
                converted_bytes, out_sr, proc_time = await asyncio.to_thread(
                    eng.convert_audio_array, audio_np, 16000
                )
                
                target_enabled = routing_config.get("target_pc_enabled", False)
                mobile_enabled = routing_config.get("mobile_speaker_enabled", True)
                target_ip = routing_config.get("target_pc_ip", "127.0.0.1")
                target_port = routing_config.get("target_pc_port", 8001)

                if target_enabled:
                    # Forward to Target PC receiver asynchronously so conversion worker isn't delayed
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
                        # Instant pong response in < 0.1ms (keeps connection alive!)
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
                    
            # 2. Binary messages (raw PCM 16-bit 16kHz audio from phone)
            elif "bytes" in message:
                raw_bytes = message["bytes"]
                audio_dur = len(raw_bytes) / (2 * 16000.0)
                
                if len(raw_bytes) < 320:
                    logger.warning("Audio chunk too short (<10ms), skipping.")
                    continue
                    
                audio_np = np.frombuffer(raw_bytes, dtype=np.int16)
                try:
                    sf.write("calibration_voice_sample.wav", audio_np, 16000)
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

@app.websocket("/ws/pc_audio")
async def websocket_pc_audio_proxy(client_ws: WebSocket):
    """Bridges live Target PC desktop/speaker audio (Discord/WhatsApp calls) to mobile phone."""
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

# Serve client web app
client_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "client")
if os.path.exists(client_dir):
    app.mount("/", StaticFiles(directory=client_dir, html=True), name="client")

if __name__ == "__main__":
    import uvicorn
    cert_exists = os.path.exists("certs/cert.pem") and os.path.exists("certs/key.pem")
    ssl_kwargs = {}
    if cert_exists:
        ssl_kwargs = {
            "ssl_keyfile": "certs/key.pem",
            "ssl_certfile": "certs/cert.pem"
        }
    uvicorn.run("server.main:app", host="0.0.0.0", port=8000, reload=False, **ssl_kwargs)
