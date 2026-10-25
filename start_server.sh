#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

# Ensure venv exists
if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Please set up the environment first."
    exit 1
fi

# PyTorch multi-threading optimizations for AMD Ryzen 3500U
export OMP_NUM_THREADS=4
export MKL_NUM_THREADS=4
export TORCH_NUM_THREADS=4

# Force offline mode for Hugging Face
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export HF_HUB_DISABLE_TELEMETRY=1

SSL_ARGS=""
if [ -f "certs/cert.pem" ] && [ -f "certs/key.pem" ]; then
    SSL_ARGS="--ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem"
    echo "🔒 SSL Enabled with SAN (192.168.1.2)"
fi

echo "=========================================================="
echo " Starting RVC Voice Changer Server on HTTPS (Port 8000)"
echo "=========================================================="

"$DIR/venv/bin/python" -m uvicorn server.main:app --host 0.0.0.0 --port 8000 $SSL_ARGS
