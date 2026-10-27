@echo off
title VoiceMorph Target PC Receiver (Port 8001)
echo ==========================================================
echo  Starting VoiceMorph Target PC Receiver for Windows
echo  Feeds: Virtual Audio Cable (VB-CABLE) for Discord
echo ==========================================================

:: 1. Ensure Virtual Audio Driver is installed
call "%~dp0install_vbcable.bat"

:: 2. Ensure Python dependencies are installed
echo [INFO] Checking Python dependencies...
pip install fastapi uvicorn websockets numpy sounddevice soundcard

:: 3. Launch Target PC Receiver on Port 8001
echo [INFO] Starting Target Receiver on http://localhost:8001...
python "%~dp0target_receiver.py"
pause
