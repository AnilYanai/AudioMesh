"""
VoiceMorph Server Configuration & Network Diagnostics Module.

Manages default audio routing states, LAN IP autodetection for mobile clients,
and SSL certificates detection for secure context (HTTPS) execution.
"""

import os
import socket
import logging

logger = logging.getLogger("VoiceServer.Config")

# Default Target PC virtual microphone routing state
# In decoupled mode, audio is forwarded directly across LAN to port 8001
routing_config = {
    "target_pc_ip": "127.0.0.1",
    "target_pc_port": 8001,
    "target_pc_enabled": True,
    "mobile_speaker_enabled": True
}

# Core audio sampling standards
INPUT_SAMPLE_RATE = 16000     # Phone microphone capture rate
MIN_AUDIO_BYTES = 320         # 10ms at 16kHz 16-bit PCM (minimum speech slice)
DEFAULT_TARGET_PORT = 8001
DEFAULT_SERVER_PORT = 8000


def get_local_ip() -> str:
    """
    Detects the machine's primary local LAN IP address (192.168.x.x or 10.x.x.x)
    so mobile devices on the same Wi-Fi network can connect directly.

    Returns:
        str: Local IPv4 address, or '127.0.0.1' if disconnected.
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        # Does not actually transmit packets; resolves local routing interface
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def get_ssl_kwargs(certs_dir: str = "certs") -> dict:
    """
    Checks if SSL certificate and private key exist for HTTPS execution.
    HTTPS is strictly required by modern mobile browsers (Chrome / Safari)
    for getUserMedia microphone access.

    Args:
        certs_dir: Directory containing cert.pem and key.pem.

    Returns:
        dict: uvicorn SSL keyword arguments (or empty dict if certs are missing).
    """
    cert_path = os.path.join(certs_dir, "cert.pem")
    key_path = os.path.join(certs_dir, "key.pem")

    if os.path.exists(cert_path) and os.path.exists(key_path):
        return {
            "ssl_certfile": cert_path,
            "ssl_keyfile": key_path
        }
    return {}
