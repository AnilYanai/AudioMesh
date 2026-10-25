import sys
import os
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from server.main import app

def test_websocket():
    print("Testing WebSocket endpoint with TestClient...")
    client = TestClient(app)
    
    with client.websocket_connect("/ws") as websocket:
        # 1. Receive welcome message
        data = websocket.receive_json()
        print("Received welcome payload:", data)
        assert data["type"] == "connected"
        assert "BlazBlue_Noel_Vermillion_English" in data["available_models"]
        
        # 2. Send 1.0 second of 16kHz audio chunk
        sr = 16000
        duration = 1.0
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        audio = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
        pcm_bytes = (audio * 32767).astype(np.int16).tobytes()
        
        print(f"Sending {len(pcm_bytes)} bytes of PCM audio over WebSocket...")
        websocket.send_bytes(pcm_bytes)
        
        # 3. Receive metadata response
        meta = websocket.receive_json()
        print("Received audio chunk metadata:", meta)
        assert meta["type"] == "audio_chunk"
        assert meta["sample_rate"] == 40000
        
        # 4. Receive converted audio binary payload
        response_bytes = websocket.receive_bytes()
        print(f"Received converted audio bytes: {len(response_bytes)} bytes")
        assert len(response_bytes) > 0
        
        print("\n✅ WebSocket audio round-trip verified successfully!")

if __name__ == "__main__":
    test_websocket()
