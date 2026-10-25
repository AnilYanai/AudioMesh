"""
VoiceMorph Target PC Receiver Client.

Handles network communication with the Target PC Receiver agent (target_receiver.py)
running on port 8001. Pushes converted female PCM audio into the PipeWire/WirePlumber
virtual microphone for Discord, Zoom, WhatsApp, and online games.
"""

import json
import base64
import asyncio
import logging
import urllib.request
from typing import Tuple, Any

logger = logging.getLogger("VoiceServer.TargetClient")


def check_target_pc(ip: str, port: int = 8001) -> Tuple[bool, Any]:
    """
    Probes the Target PC receiver agent health check endpoint (GET /status).

    Args:
        ip: Target PC IPv4 address (e.g., '127.0.0.1' or '192.168.1.X').
        port: Receiver port (default 8001).

    Returns:
        tuple[bool, dict | str]: (is_reachable, details_dictionary_or_error_string)
    """
    try:
        url = f"http://{ip}:{port}/status"
        req = urllib.request.Request(url, headers={"User-Agent": "VoiceMorphServer"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return True, data
    except Exception as e:
        return False, str(e)
    return False, "Unreachable"


async def forward_to_target_pc(pcm_bytes: bytes, sr: int, ip: str, port: int) -> bool:
    """
    Asynchronously forwards converted audio bytes to the Target PC virtual microphone.
    Executes in a thread to prevent blocking the asynchronous event loop.

    Args:
        pcm_bytes: 16-bit signed PCM raw audio bytes.
        sr: Output sample rate (e.g., 40000 Hz for DSP or 16000 Hz).
        ip: Target PC IP address.
        port: Target PC Receiver port (8001).

    Returns:
        bool: True if delivered successfully, False otherwise.
    """
    try:
        b64 = base64.b64encode(pcm_bytes).decode("ascii")
        url = f"http://{ip}:{port}/audio"
        payload = json.dumps({"pcm_b64": b64, "sample_rate": sr}).encode("utf-8")

        def _post():
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                return resp.status

        status = await asyncio.to_thread(_post)
        logger.info(f"📡 [Target PC] Stream delivered to Virtual Mic on {ip}:{port} (HTTP {status})")
        return True
    except Exception as e:
        logger.warning(f"Could not forward audio to Target PC {ip}:{port}: {e}")
        return False
