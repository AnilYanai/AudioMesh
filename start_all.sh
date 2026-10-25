#!/usr/bin/env bash
# Starts both Voice Changer Server (Port 8000) and Target PC Receiver (Port 8001)
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

echo "=========================================================="
echo " 🎙️  VoiceMorph Full-Stack Launcher"
echo " 1. Target PC Receiver:       http://localhost:8001"
echo " 2. Voice Changer HTTPS App:  https://192.168.1.2:8000"
echo "=========================================================="

# Trap SIGINT/SIGTERM to kill background receiver on exit
trap 'echo "Stopping VoiceMorph..."; kill $(jobs -p) 2>/dev/null' EXIT

# Start receiver in background
"$DIR/receiver/run_receiver_linux.sh" &
RECEIVER_PID=$!
echo "✅ Target PC Virtual Mic Receiver active (PID: $RECEIVER_PID)"

# Start main server in foreground
"$DIR/start_server.sh"
