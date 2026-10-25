#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
PARENT_DIR="$(dirname "$DIR")"
cd "$DIR"

echo "=========================================================="
echo " Starting VoiceMorph Target PC Receiver (Port 8001)"
echo " Feeds: 'VoiceMorph Virtual Microphone' for Discord"
echo "=========================================================="

export PYTHONPATH="$PARENT_DIR:$PYTHONPATH"

if [ -f "$PARENT_DIR/venv/bin/python" ]; then
    PYTHON="$PARENT_DIR/venv/bin/python"
else
    PYTHON="python3"
fi

"$PYTHON" target_receiver.py
