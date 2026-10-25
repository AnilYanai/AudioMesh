"""
VoiceMorph Target PC Audio Receiver Agent (Port 8001).

Runs as a lightweight daemon on the machine running Discord, WhatsApp, Zoom, or games.
Responsibilities:
1. Virtual Microphone Creation:
   - Linux: Uses PipeWire (pw-loopback) to create 'VoiceMorph_Sink' and 'VoiceMorph_Mic'.
   - Converted female voice feeds into 'VoiceMorph_Sink' -> outputs through 'VoiceMorph_Mic'.
   - Discord selects 'VoiceMorph Virtual Microphone' as its input device.
2. Ingestion Endpoints:
   - POST /audio: Ingests base64-encoded PCM audio chunks and plays them into the virtual mic.
   - GET /status: Health check queried by the main voice server and mobile UI.
3. Audio Downlink:
   - WS /pc_audio: Captures desktop/call output at 48kHz Stereo via PipeWire sink monitor,
     streaming audio back to the mobile phone earphones so users can hear call peers.
"""

import os
import sys
import time
import json
import platform
import subprocess
import asyncio
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("TargetReceiver")

app = FastAPI(title="VoiceMorph Target PC Audio Receiver")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_OS = platform.system()
VIRTUAL_MIC_NAME = "VoiceMorph Virtual Microphone"
pipewire_process = None

def setup_linux_virtual_mic():
    """Sets up a virtual microphone source on Linux using PipeWire/PulseAudio."""
    global pipewire_process
    logger.info("Initializing Linux Virtual Microphone...")
    
    # Kill any stale loopback instances first to avoid duplicate nodes
    try:
        subprocess.run(["pkill", "-f", "VoiceMorph_Sink"], stderr=subprocess.DEVNULL)
    except Exception:
        pass
    
    # Check if pw-loopback is available
    has_pw = subprocess.run(["which", "pw-loopback"], capture_output=True).returncode == 0
    if has_pw:
        try:
            # Create a virtual sink and link it as a virtual source (microphone) with proper capture ports
            cmd = [
                "pw-loopback",
                "-m", "[FL FR]",
                "--capture-props=media.class=Audio/Sink node.name=VoiceMorph_Sink node.description='VoiceMorph Virtual Sink'",
                "--playback-props=media.class=Audio/Source node.name=VoiceMorph_Mic node.description='VoiceMorph Virtual Microphone'"
            ]
            pipewire_process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            logger.info("✅ PipeWire Virtual Microphone ('VoiceMorph Virtual Microphone') created!")
            return True
        except Exception as e:
            logger.warning(f"Note on pw-loopback: {e}")
    return False

def play_audio_to_mic(pcm_bytes: bytes, sample_rate: int = 16000):
    """Feeds PCM bytes into the Virtual Mic sink."""
    try:
        if SYSTEM_OS == "Linux":
            # Check pw-cat first, then fallback to aplay
            has_pw_cat = subprocess.run(["which", "pw-cat"], capture_output=True).returncode == 0
            if has_pw_cat:
                p = subprocess.Popen(
                    ["pw-cat", "--playback", f"--rate={sample_rate}", "--format=s16", "--channels=1", "--target=VoiceMorph_Sink", "-"],
                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
                p.communicate(input=pcm_bytes)
            else:
                p = subprocess.Popen(
                    ["aplay", "-t", "raw", f"-r", str(sample_rate), "-f", "S16_LE", "-c", "1"],
                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
                p.communicate(input=pcm_bytes)
        elif SYSTEM_OS == "Windows":
            # On Windows with sounddevice or PyAudio
            try:
                import sounddevice as sd
                audio_np = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                sd.play(audio_np, sample_rate)
            except Exception as we:
                logger.warning(f"Windows audio play note: {we}")
    except Exception as e:
        logger.error(f"Error feeding audio to virtual mic: {e}")

@app.on_event("startup")
async def startup_event():
    if SYSTEM_OS == "Linux":
        setup_linux_virtual_mic()
    logger.info(f"Target Receiver running on {SYSTEM_OS}. Listening on port 8001...")

@app.on_event("shutdown")
def shutdown_event():
    global pipewire_process
    if pipewire_process:
        try:
            pipewire_process.terminate()
            logger.info("PipeWire virtual loopback terminated.")
        except Exception:
            pass
    if SYSTEM_OS == "Linux":
        try:
            subprocess.run(["pkill", "-f", "VoiceMorph_Sink"], stderr=subprocess.DEVNULL)
        except Exception:
            pass

@app.get("/status")
@app.get("/health")
async def get_status():
    """Health check endpoint queried by Voice Changer Server / Mobile UI."""
    return {
        "status": "online",
        "platform": SYSTEM_OS,
        "virtual_mic": VIRTUAL_MIC_NAME,
        "active": True,
        "time": time.time()
    }

@app.post("/audio")
async def receive_audio_post(data: dict):
    """Receive audio payload over HTTP POST."""
    import base64
    b64 = data.get("pcm_b64", "")
    sr = data.get("sample_rate", 16000)
    if b64:
        pcm_bytes = base64.b64decode(b64)
        logger.info(f"🎙️ Received {len(pcm_bytes)} audio bytes via HTTP. Pumping into Virtual Mic...")
        # Pump audio in non-blocking background task so response is instant and never times out
        asyncio.create_task(asyncio.to_thread(play_audio_to_mic, pcm_bytes, sr))
        return {"status": "played", "bytes": len(pcm_bytes)}
    return JSONResponse({"error": "No audio"}, status_code=400)

@app.websocket("/stream")
async def websocket_stream(websocket: WebSocket):
    """Low-latency binary audio stream direct from Voice Changer Server."""
    await websocket.accept()
    logger.info("Voice Changer Server connected to Target PC Receiver via WebSocket!")
    
    current_sr = 16000
    try:
        while True:
            msg = await websocket.receive()
            if "text" in msg:
                try:
                    payload = json.loads(msg["text"])
                    if payload.get("type") == "meta":
                        current_sr = payload.get("sample_rate", 16000)
                except Exception:
                    pass
            elif "bytes" in msg:
                raw_bytes = msg["bytes"]
                logger.info(f"🎙️ Received {len(raw_bytes)} audio bytes over stream. Feeding Virtual Mic...")
                await asyncio.to_thread(play_audio_to_mic, raw_bytes, current_sr)
    except WebSocketDisconnect:
        logger.info("Voice Server disconnected from Target Receiver.")
    except Exception as e:
        logger.error(f"Target Receiver stream error: {e}")

def read_exact_bytes(stream, n: int) -> bytes:
    """Reads exactly n bytes from stream to prevent partial-read sample fragmentation and clicks."""
    buf = bytearray()
    while len(buf) < n:
        packet = stream.read(n - len(buf))
        if not packet:
            break
        buf.extend(packet)
    return bytes(buf)

@app.websocket("/pc_audio")
async def websocket_pc_audio(websocket: WebSocket):
    """Streams Target PC's desktop/speaker audio (calls/music) to mobile listener in pristine 48kHz stereo."""
    await websocket.accept()
    logger.info("🎧 Client connected to Target PC Audio stream!")
    proc = None
    try:
        # Send stream metadata to client so Web Audio configures exact rate & channels
        meta = {
            "type": "stream_info",
            "sample_rate": 48000,
            "channels": 2,
            "format": "s16le"
        }
        await websocket.send_text(json.dumps(meta))

        if SYSTEM_OS == "Linux":
            # 48kHz Stereo 16-bit direct capture from default sink monitor (pure studio quality, zero phase cancellation)
            # Explicitly tagged with media-role=Music and media-category=Playback so PipeWire does not treat it as a telephony call
            cmd = [
                "pw-record",
                "-P", "stream.capture.sink=true",
                "--latency=20ms",
                "--media-type=Audio",
                "--media-category=Playback",
                "--media-role=Music",
                "--rate=48000",
                "--format=s16",
                "--channels=2",
                "-"
            ]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=0, stderr=subprocess.DEVNULL)
            loop = asyncio.get_running_loop()
            # 4096 bytes = 1024 stereo frames (~21.33ms low-latency chunk for video lip-sync)
            while True:
                chunk = await loop.run_in_executor(None, read_exact_bytes, proc.stdout, 4096)
                if not chunk:
                    break
                await websocket.send_bytes(chunk)
        elif SYSTEM_OS == "Windows":
            await websocket.send_text(json.dumps({"error": "Windows PC audio streaming coming soon"}))
            await asyncio.sleep(1)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception as e:
        logger.warning(f"PC audio stream error: {e}")
    finally:
        if proc:
            try:
                proc.terminate()
            except Exception:
                pass
        logger.info("🎧 PC audio stream closed.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
