@echo off
title VoiceMorph Target PC Receiver (Port 8001)
echo ==========================================================
echo  Starting VoiceMorph Target PC Receiver for Windows
echo  Feeds: Virtual Audio Cable (VB-CABLE) for Discord
echo ==========================================================

pip install fastapi uvicorn websockets numpy sounddevice
python target_receiver.py
pause
