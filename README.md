# 🌐 AudioMesh: Distributed Low-Latency Wireless Audio Network & Virtual Studio

[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20Android%20%7C%20iOS-blue.svg)](https://github.com/)
[![Latency](https://img.shields.io/badge/Latency-Sub--45ms-success.svg)](https://github.com/)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](https://github.com/)

**AudioMesh** is an open-source, full-duplex distributed audio networking framework that transforms local Wi-Fi into an interconnected audio fabric. It seamlessly bridges desktop operating systems (Linux PipeWire & Windows WASAPI) with mobile devices to provide **synchronized multi-device audio streaming**, **wireless virtual microphone routing**, and **real-time neural voice transformation**.

---

## 🏗️ System Architecture

```
                       ┌────────────────────────────────────────────────────────┐
                       │                   HOST WORKSTATION                     │
                       │           (Linux PipeWire / Windows WASAPI)            │
                       └───────────▲────────────────────────────────┬───────────┘
                                   │                                │
                      [Uplink: Virtual Mic]           [Downlink: 48kHz Stereo]
                                   │                                │
               ┌───────────────────┴────────────────────────────────┴───────────────────┐
               │                        AudioMesh WebSocket LAN Hub                     │
               │                   (FastAPI • PyTorch RVC • DBus MPRIS)                 │
               └───────────▲───────────────────────▲────────────────────────▲───────────┘
                           │                       │                        │
                    Wi-Fi Stream 1          Wi-Fi Stream 2           Wi-Fi Stream 3
                           │                       │                        │
                 ┌─────────▼────────┐    ┌─────────▼────────┐     ┌─────────▼────────┐
                 │  Mobile Node A   │    │  Mobile Node B   │     │  Mobile Node C   │
                 │  (45ms Earphones)│    │  (Silent Disco)  │     │  (Hardware Remote│
                 └──────────────────┘    └──────────────────┘     └──────────────────┘
```

---

## ⚡ Core Capabilities

### 1. Multi-Device Wireless Audio Hub (The Downlink)
* **Synchronized Group Listening**: Broadcast pristine 48 kHz stereo PC desktop sound (games, movies, meetings, music) to multiple mobile devices simultaneously over local Wi-Fi.
* **45ms Ultra-Sync Latency**: Engineered with an adaptive raised-cosine jitter cushion and zero-void underrun recovery for lip-sync gaming and video watching.
* **Desktop Remote Control Bridge**: Forward headphone physical hardware buttons (Single-tap Play/Pause, Double-tap Next, Triple-tap Prev) and Android lock-screen controls directly to desktop media players over **Linux DBus (MPRIS)** and **Windows WASAPI**.

### 2. Wireless Virtual Microphone (The Uplink)
* Turn any smartphone into a wireless studio microphone for **Discord, Zoom, WhatsApp, or PC Games**.
* **Linux**: Zero driver installation required; dynamically provisions virtual sinks via native PipeWire loopback (`pw-loopback`).
* **Windows**: Automated 1-click driver installation script with silent UAC elevation and WASAPI routing.
* Modes: Push-to-Talk (PTT walkie-talkie) and continuous Live Streaming with acoustic echo suppression.

### 3. Real-Time Neural Voice & DSP Studio (Creative Suite)
* Integrated PyTorch CPU-optimized neural speech engine (HuBERT + VITS / RVC).
* **Bi-Directional Voice Transformation**:
  * 🧔 **Deep Male Broadcast (-12 semitones)**: Rich, deep radio host / masculine timbre.
  * 🎙️ **Studio Natural (0 semitones)**: Clean passthrough with formant enhancement and dynamic compression.
  * 👧 **Bright Tone (+12 semitones)**: High-register vocal pitch shifting.
* Built-in dynamic noise gate and spectral background noise subtraction.

---

## 🚀 Quick Start Guide

### Prerequisites
* Python 3.10+
* Linux (with PipeWire / PulseAudio) or Windows 10/11
* Modern mobile browser (Chrome on Android, Safari on iOS)

### 1. Start the AudioMesh Server
On your host PC:

**Linux**:
```bash
git clone https://github.com/YOUR_USERNAME/AudioMesh.git
cd AudioMesh
./start_all.sh
```

**Windows**:
```bat
git clone https://github.com/YOUR_USERNAME/AudioMesh.git
cd AudioMesh
receiver\run_receiver_windows.bat
start_server.bat
```

### 2. Connect Mobile Devices
1. Connect your phone(s) to the **same Wi-Fi network**.
2. Open Chrome or Safari and navigate to:
   ```text
   https://<HOST_PC_IP>:8000
   ```
   *(Accept the local self-signed SSL certificate prompt to unlock browser microphone and audio focus permissions).*
3. Tap **"Start Listening to PC Audio"** to join the audio mesh!
4. Connect as many devices as you like — all connected phones listen in real time.

---

## 🛠️ Technology Stack

* **Audio Core**: Web Audio API (AudioContext, GainNode, DynamicsCompressor, AnalyserNode).
* **Mobile OS Bridge**: Web MediaSession API, Android AudioTrack / AAudio HAL, Android NotificationCompat.
* **Backend Services**: FastAPI, Uvicorn (ASGI), Python `asyncio`, WebSockets.
* **Desktop Audio Routing**: 
  * Linux: PipeWire Graph (`pw-loopback`, `pw-record`, `pw-cat`), DBus MPRIS v2.
  * Windows: WASAPI Loopback (`soundcard`), Windows Virtual Keys (`ctypes`), VB-Audio Virtual Cable.
* **AI & DSP**: PyTorch, PyWorld vocoder, HuBERT, Librosa, SoundFile, NumPy.

---

## 📄 License
Released under the [MIT License](LICENSE). Contributions, bug reports, and pull requests are welcome!
