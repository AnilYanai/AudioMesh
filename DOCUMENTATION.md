# 🎙️ VoiceMorph: High-Performance Mobile Voice Changer Architecture & Guide

An AI & DSP hybrid voice conversion server engineered for the **AMD Ryzen 5 3500U (Vega 8 / 8GB RAM)** with a low-latency mobile Progressive Web App (PWA) client.

---

## 📑 Table of Contents
1. [Project Overview & Hardware Feasibility](#1-project-overview--hardware-feasibility)
2. [Dual-Engine System Architecture](#2-dual-engine-system-architecture)
   - [Engine A: ⚡ Instant Fast Mode (PyWorld Vocoder DSP)](#engine-a--instant-fast-mode-pyworld-vocoder-dsp)
   - [Engine B: 🧠 RVC AI Neural Mode (HuBERT + VITS)](#engine-b--rvc-ai-neural-mode-hubert--vits)
3. [Decoupled 3-Tier Architecture for Discord & Calls](#3-decoupled-3-tier-architecture-for-discord--calls)
   - [The Decoupled Model (Mobile Mic → Server → Target PC Mic)](#the-decoupled-model-mobile-mic--server--target-pc-mic)
   - [Target PC Virtual Mic Receiver](#target-pc-virtual-mic-receiver)
   - [Audio Routing & Feedback Loop Prevention](#audio-routing--feedback-loop-prevention)
   - [Live Connection Verification & Diagnostics](#live-connection-verification--diagnostics)
4. [Network & Audio Streaming Pipeline](#4-network--audio-streaming-pipeline)
   - [Asynchronous Decoupled Queue](#asynchronous-decoupled-queue)
   - [Mobile HTTPS & SSL with SAN](#mobile-https--ssl-with-san)
5. [Client-Side Web Audio Architecture](#5-client-side-web-audio-architecture)
6. [Directory & File Structure](#6-directory--file-structure)
7. [How to Start & Use the System](#7-how-to-start--use-the-system)
   - [Single-Command Full Stack (Server + Receiver on same PC)](#single-command-full-stack-server--receiver-on-same-pc)
   - [Decoupled Setup (Server on Ryzen, Receiver on another PC)](#decoupled-setup-server-on-ryzen-receiver-on-another-pc)
   - [Configuring Discord / WhatsApp / Meet](#configuring-discord--whatsapp--meet)
8. [Adding New Voice Models](#8-adding-new-voice-models)
9. [Troubleshooting & FAQs](#9-troubleshooting--faqs)

---

## 1. Project Overview & Hardware Feasibility

### The Goal
Capture human voice on a mobile phone (Android/iOS), stream it over local Wi-Fi to a host PC, convert any input voice into a clean, natural female voice, and stream it back to the phone with low latency.

### Hardware Constraints & Solutions

| Hardware Component | Spec & Limitations | Engineering Solution |
| :--- | :--- | :--- |
| **CPU** | AMD Ryzen 5 3500U (4 cores / 8 threads, Zen+ Mobile) | Thread contention avoided by locking PyTorch to 4 physical cores (`OMP_NUM_THREADS=4`). |
| **GPU** | Radeon Vega 8 iGPU (gfx902) — ROCm is not supported on Linux | Inference runs entirely on CPU with AVX2 multi-threaded math. |
| **RAM** | 8 GB total (~5.7 GB visible, remainder reserved for VRAM) | Headless FastAPI backend; zero bloated desktop GUIs; offline model caching. |
| **Latency Challenge** | Heavy 120M-parameter neural networks take 5–10s on CPU | **Dual-Engine Architecture**: 0.2s Instant DSP for immediate responses + Optimized RVC for neural cloning. |

---

## 2. Dual-Engine System Architecture

VoiceMorph uses a **hybrid dual-engine architecture**, allowing users to seamlessly toggle between **instant sub-second speed** and **deep neural voice cloning**.

```
                   [ Mobile Client Mic (16kHz PCM) ]
                                  │
                                  ▼ (WebSocket / TLS)
                     [ FastAPI Server Router ]
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
[ ⚡ Engine A: Instant DSP ]                 [ 🧠 Engine B: RVC Neural AI ]
• PyWorld Vocoder                            • ContentVec / HuBERT Base
• DIO + StoneMask Pitch Tracking             • Parselmouth (PM) Pitch Predictor
• CheapTrick Formant Extraction              • Low-Latency Padding (t_pad=2400)
• +11 Semitones F0 Pitch Shift               • FAISS Bypass (index=0.0)
• 1.16x Vocal Tract Rescaling                • VITS / HiFi-GAN Generative Decoder
• Synthesis: ~0.20s                          • Synthesis: ~5.0s – 7.0s
         │                                                 │
         └────────────────────────┬────────────────────────┘
                                  │
                                  ▼
                 [ Converted Audio Stream to Mobile ]
```

---

### Engine A: ⚡ Instant Fast Mode (PyWorld Vocoder DSP)

**Compute Time:** `~0.15s – 0.30s` (over **$10\times$ faster than real-time**)  
**Best For:** Live conversations, zero-wait Push-to-Talk, real-time live streaming.

#### The Acoustic Physics
A human female voice differs from a male voice in two fundamental acoustic dimensions:
1. **Fundamental Frequency ($F_0$)**: Male vocal cords vibrate between $85\text{–}155\text{ Hz}$, whereas female vocal cords vibrate between $165\text{–}255\text{ Hz}$.
2. **Vocal Tract Formants ($F_1, F_2, F_3$)**: An average adult female vocal tract is $\sim 14.5\text{ cm}$ long, compared to $\sim 17.5\text{ cm}$ in males (approximately $16\%$ shorter). Shorter tubes resonate at higher frequencies.

If you *only* pitch shift, you get a high-pitched "chipmunk" sound.  
**PyWorld transforms both simultaneously:**

$$\text{Pitch Shift: } F_{0,\text{female}}(t) = F_{0,\text{male}}(t) \cdot 2^{\frac{\Delta \text{semitones}}{12}} \quad (\Delta = +11\text{ semitones})$$

$$\text{Formant Rescaling: } S_{\text{female}}(\omega) = S_{\text{male}}\left(\frac{\omega}{\alpha}\right) \quad (\alpha = 1.16)$$

#### The 5-Stage PyWorld Pipeline:
1. **`pw.dio`**: High-speed fundamental frequency ($F_0$) estimation across 5ms time windows.
2. **`pw.stonemask`**: Refines the pitch contour using instantaneous frequency analysis.
3. **`pw.cheaptrick`**: Extracts the smoothed spectral envelope, isolating the speaker's vocal tract formants from harmonics.
4. **`pw.d4c`**: Extracts aperiodicity (breathiness, consonant noise, unvoiced sounds).
5. **`pw.synthesize`**: Recombines the shifted pitch, compressed formants, and aperiodic noise into natural female speech in under **300 milliseconds**.

---

### Engine B: 🧠 RVC AI Neural Mode (HuBERT + VITS)

**Compute Time:** `~5.0s – 8.0s` (for 1.5–2.0s of speech)  
**Best For:** Character-specific voice cloning (e.g. matching an exact female personality like Noel Vermillion).

#### Neural Network Breakdown:
1. **Semantic Encoder (HuBERT Base)**:
   - 12-layer Transformer model (95 million parameters).
   - Extracts 768-dimensional phonetic vectors (`hidden_states`), stripping away the speaker's personal identity while preserving the words spoken.
2. **Pitch Predictor (Parselmouth / PM)**:
   - Uses acoustic autocorrelation to map the exact pitch curve.
3. **VITS HiFi-GAN Synthesizer (`net_g`)**:
   - Conditional variational autoencoder with adversarial flow layers.
   - Takes the HuBERT phoneme representations and target pitch, synthesizing them using the female target speaker's voice model weights (`.pth`).

#### Applied CPU Optimizations for Ryzen 3500U:
- **FAISS Bypass (`index_influence = 0.0`)**: Eliminates the multi-thousand vector nearest-neighbor CPU search across the 77MB `.index` file, saving **2 to 4 seconds**.
- **Low-Latency Padding (`t_pad = 2400`)**: Reduced from RVC's default 16,000 samples ($1.0\text{s}$) down to 2,400 samples ($0.15\text{s}$), cutting unnecessary neural computations by **$\sim 35\%$**.
- **Offline Caching (`HF_HUB_OFFLINE=1`)**: Eliminates 30-second HuggingFace DNS/network verification timeouts.

---

## 3. Decoupled 3-Tier Architecture for Discord & Calls

To use the voice changer in real-time communication apps like **Discord, WhatsApp, Google Meet, Zoom, or online games**, VoiceMorph employs a **fully decoupled 3-tier two-way architecture**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   📱 TIER 1: Mobile Phone (Wireless Headset)                │
│  • Uplink (Mic): Speaks naturally -> sends 16kHz PCM audio over local Wi-Fi │
│  • Downlink (Earphones): Hears PC call audio (Discord/WhatsApp) streamed    │
│    live to phone with adjustable earphone volume                            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ WebSocket (TLS)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   💻 TIER 2: Voice Changer Server (Ryzen 3500U)             │
│  • Converts voice to female (Instant DSP in ~0.2s or RVC Neural)            │
│  • Dispatches converted audio directly across LAN to Target PC              │
│  • Proxies PC Call Audio stream back to mobile phone                        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ LAN HTTP / WebSocket
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   🖥️ TIER 3: Target PC Receiver (Port 8001)                 │
│  • Runs on ANY PC on your Wi-Fi (this laptop OR a gaming desktop)           │
│  • Pumps converted voice into "VoiceMorph Virtual Microphone"               │
│  • Discord / WhatsApp selects "VoiceMorph Virtual Microphone" as input!     │
│  • Captures desktop/call output via PipeWire monitor to stream to phone     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### The Decoupled Model (Two-Way Wireless Communicator)

In traditional voice changers, the voice changer software and the communications app (Discord/WhatsApp) must run on the exact same computer, and the user is tethered to a wired desktop headset.

With VoiceMorph:
1. **Full Two-Way Wireless Communication**:
   - **Talk**: When you speak into your phone, your converted female voice flows live into the Target PC's virtual microphone for Discord.
   - **Listen**: When other people on Discord talk, their voices stream directly from the Target PC to your phone earphones! You can walk anywhere around your house on Wi-Fi with full freedom.
2. **The Server is Decoupled from the Target PC**:
   - The Voice Changer Server can run on your AMD Ryzen laptop sitting in the corner.
   - The Target PC can be **the same laptop (`127.0.0.1`)** OR **another gaming desktop/laptop (`192.168.1.X`)** on your local network.
   - The target machine only needs a featherweight audio receiver agent (`target_receiver.py`), consuming virtually 0% CPU.
3. **Direct Server-to-Target Routing**:
   - Converted audio is sent directly across LAN from server to target PC, saving phone battery and eliminating double Wi-Fi latency hops.

---

### Target PC Virtual Mic Receiver (`receiver/target_receiver.py`)

The receiver is a standalone, lightweight daemon listening on port `8001`:
- **Linux (PipeWire / WirePlumber)**:
  - Creates a loopback device with standard stereo channel map (`-m '[FL FR]'`):
    - Sink side: `VoiceMorph_Sink` (`media.class=Audio/Sink`) — receiving converted audio.
    - Source side: `VoiceMorph_Mic` (`media.class=Audio/Source`) — exposing native capture ports (`capture_FL`, `capture_FR`) that WirePlumber, Discord, and Chrome automatically link to.
- **Desktop/Call Audio Capture**:
  - Captures the Target PC's speaker/headphone output using `pw-record -P stream.capture.sink=true --rate=48000 --format=s16 --channels=2 -`.
  - Streams the desktop audio over `WS /pc_audio` to the mobile phone.
- **REST & WebSocket Endpoints**:
  - `GET /status`: Health check queried by the server and mobile UI.
  - `POST /audio`: Ingestion of converted PCM audio for the virtual microphone.
  - `WS /pc_audio`: Live binary stream of Target PC speaker/call audio.

---

### How Python Acts as a Driver (User Space vs. Kernel Space)

A common engineering question: *Why is this driver written in Python instead of low-level C?*

Traditional hardware drivers (for USB audio interfaces or motherboard sound chips) must be written in **C / C++ running in Kernel Space (Ring 0)** to manipulate physical PCIe/USB electrical registers. However:
1. **User Space (Ring 3) Virtual Nodes**:
   - Modern Linux audio servers (PipeWire) are written in C. PipeWire exposes an IPC interface that allows user-space programs to create virtual audio endpoints dynamically.
   - When Python runs `pw-loopback`, PipeWire's C core registers `"VoiceMorph Virtual Microphone"` directly with the OS audio subsystem.
   - Applications like Discord, Zoom, and Chrome interact with it exactly like a physical USB microphone.
2. **The Conductor Model**:
   - PipeWire's C engine provides the low-latency audio buffer and driver interface.
   - Python acts as the network conductor: receiving converted audio over Wi-Fi, writing bytes into the PipeWire sink, and capturing desktop monitor output.
3. **The 2 Running Services (Tasks)**:
   - **Task 1 (Port 8000 - Voice Server)**: CPU-heavy voice conversion engine and HTTPS web app host.
   - **Task 2 (Port 8001 - Target Receiver)**: Featherweight (~0% CPU) audio driver bridge to Discord. Both run seamlessly via `./start_all.sh` or across two separate PCs.

---

### Audio Routing & Feedback Loop Prevention (Verified Stable Architecture: v20261025_walkie_talkie_monitor_v17)

A critical hazard in virtual microphone setups is **acoustic and electrical feedback loops** (where converted audio plays through physical speakers/earphones, re-enters the microphone, and creates uncontrollable echoes).

VoiceMorph prevents feedback by architectural design:
1. **Target PC Receiver feeds ONLY the Virtual Mic Sink**:
   - Converted audio is routed strictly into `VoiceMorph_Sink` (the virtual microphone input for Discord).
   - Converted audio is **never** sent to the Target PC's physical speakers.
2. **Decoupled Mode Specialization**:
   - **`⚡ Live Streaming` Mode (for Discord / Gaming / Live Calls)**:
     - Voice is streamed continuously from the phone mic to the server, converted in real-time ($0.2\text{s}$), and routed **strictly into the Target PC Virtual Mic** (`VoiceMorph_Mic`).
     - The phone **does not play the user's converted voice back into the phone earphones**. This eliminates Delayed Auditory Feedback and makes a local echo loop **100% physically impossible**.
     - Meanwhile, the user can turn on **"Start Listening to PC Calls"** to hear Discord teammates live in their phone earphones with zero conflict.
   - **`📻 Walkie-Talkie` Mode (for Voice Testing, Calibration & Monitoring)**:
     - The user holds or taps to talk. The microphone captures only while speaking.
     - On release, the microphone stops recording, and the converted female voice **plays back clearly through the phone earphones** for monitoring and calibration.
     - Because recording finishes before playback begins, **zero feedback loop can occur**.
3. **Independent Output Destination Switches**:
   - `🖥️ Stream to Target PC Mic`: Toggle ON/OFF to feed Discord/WhatsApp.
   - `📱 Hear on Mobile Phone`: Controls voice playback during Walkie-Talkie mode. If disabled, the phone stays completely silent.

---

### Live Connection Verification & Diagnostics

Inside the mobile web app under the **🖥️ PC Virtual Mic** tab:
- **Target PC IP & Port Inputs**: Enter `127.0.0.1` (if running on the same laptop) or any local IP (`192.168.1.X`). A quick-fill **"This PC"** button is provided.
- **Verify Driver & Connection Button**:
  - Tapping this button immediately queries the receiver at `http://{ip}:{port}/status`.
  - **Live Animated Status Badge**:
    - `🟢 Connected ✓`: Receiver is active, and the virtual mic device is ready for Discord.
    - `🔴 Offline ✗`: Shows why connection failed (e.g., driver script not started, wrong IP).
- **Driver Details Panel**:
  - Displays Driver Status, Operating System (Linux / Windows), and Active Virtual Mic Device name.

---

## 4. Network & Audio Streaming Pipeline

### Asynchronous Decoupled Queue
In traditional synchronous WebSockets, running a multi-second CPU inference task blocks the entire server thread. When the phone sends keep-alive pings, the server fails to reply with `pong`, causing the phone browser to drop the connection.

VoiceMorph separates the WebSocket communication and the audio worker into **two independent asynchronous coroutines**:

```
[ WebSocket Receive Loop ] ──(Pings)──> Returns "pong" in < 1ms (Connection NEVER drops)
           │
      (Audio Bytes)
           │
           ▼
 [ asyncio.Queue ]
           │
           ▼
[ Dedicated Worker Task ] ──(Worker Thread)──> Runs VoiceEngine.convert_audio_array()
           │
           ▼
   [ Stream Output ] ───────> Delivers converted audio payload to mobile client
```

### Mobile HTTPS & SSL with SAN
Mobile browsers (Android Chrome and iOS Safari) enforce strict security:
- `navigator.mediaDevices.getUserMedia` is **completely disabled** on plain `http://<LAN_IP>`.
- Self-signed SSL certificates without a **Subject Alternative Name (SAN)** will cause Chrome to show `ERR_CERT_COMMON_NAME_INVALID` without a "Proceed" option.

VoiceMorph generates an SSL certificate containing explicit SAN IP extensions:
```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/key.pem -out certs/cert.pem -days 365 \
  -subj "/CN=192.168.1.2" \
  -addext "subjectAltName=IP:192.168.1.2,IP:127.0.0.1,DNS:localhost"
```
This enables the standard Chrome **"Advanced $\rightarrow$ Proceed to 192.168.1.2"** button, placing the mobile app into a **Secure Context** where microphone access is permanently granted.

---

## 5. Client-Side Modular Web Audio Architecture

The client has been refactored from a monolithic script into an **enterprise-grade, modular ES6 architecture** inside `client/js/`:

```
📁 client/js/
├── state.js           - Central reactive state, DOM cache, logging & telemetry (234 lines)
├── audio-core.js      - Web Audio API graph, microphone lifecycle, RMS & noise gate (474 lines)
├── voice-ws.js        - Conversion WebSocket /ws, heartbeat, feedback-free router (275 lines)
├── ptt.js             - Walkie-Talkie Push-to-Talk gestures & PCM chunking (161 lines)
├── live-stream.js     - Real-time continuous live streaming engine (80 lines)
├── target-pc.js       - Virtual Mic driver verification & routing configuration (193 lines)
├── pc-audio.js        - PC Desktop/Call audio downlink /ws/pc_audio & jitter buffer (264 lines)
├── room-calibrator.js - 1.5-second ambient room noise calibration engine (112 lines)
├── visualizer.js      - Audio frequency bar visualizer & idle wave animation (63 lines)
├── ui-controls.js     - Sliders, vocal profile buttons, engine toggle & tab navigation (248 lines)
└── main.js            - Application bootstrap and developer diagnostics handle (71 lines)
```

### Module Responsibilities:
1. **Microphone Capture & Telephony Isolation (`audio-core.js`)**:
   - Manages `AudioContext`, input gain, and hardware `75Hz` low-cut highpass.
   - Dual-Profile switching:
     - **📞 Call Mode**: Activates hardware Echo Cancellation (AEC) and routes to phone earpiece for private calls.
     - **🎵 Music Mode**: Bypasses AEC completely, releases microphone lock, and switches physical phone buttons to full-fidelity Media Volume.
2. **Decoupled Output Routing (`voice-ws.js`)**:
   - In **Live Mode**: Converted voice streams strictly to the Target PC Virtual Mic (`VoiceMorph_Mic`). The phone earphone output is bypassed, **eliminating acoustic/electrical feedback loops 100%**.
   - In **Walkie-Talkie Mode**: Half-duplex playback into phone earphones for timbre monitoring.
3. **Target PC Audio Downlink (`pc-audio.js`)**:
   - Connects to `/ws/pc_audio` for live PipeWire monitor capture.
   - Implements a gapless **200ms Jitter Buffer** with drift protection.
   - Features a studio Call Mode DSP chain ($85\text{Hz}$ low-cut, $+3.5\text{dB}$ presence lift at $2.8\text{kHz}$, dynamics compressor).
4. **Interactive Gesture Engine (`ptt.js` & `live-stream.js`)**:
   - Distinguishes Hold-to-Talk ($\ge 400\text{ms}$) from Tap-to-Talk ($< 400\text{ms}$).
   - Handles real-time chunked streaming with adjustable interval ($1.0\text{s} - 2.5\text{s}$).
5. **Acoustic Calibration (`room-calibrator.js`)**:
   - 1.5s silent ambient noise sampling.
   - Computes median RMS to reject click artifacts and switches between **Fan ON Mode** (forward boost) and **Quiet Room Mode** (transparent).
6. **Console Diagnostics (`window.VoiceMorph`)**:
   - Exposes internal reactive state, nodes, and test routines in browser DevTools.

---

## 6. Directory & File Structure

```text
/home/mathavan/Documents/voice changer/
├── backup_v17_baseline/             # Full immutable backup of pre-modular baseline (v17)
├── certs/
│   ├── cert.pem                     # SSL Certificate with SAN IP extensions
│   └── key.pem                      # SSL Private Key
├── client/
│   ├── index.html                   # Mobile-first Web UI (PTT, Live Stream, PC Virtual Mic)
│   ├── styles.css                   # Cyber-glow dark UI with glassmorphism & visualizer
│   ├── manifest.json                # PWA manifest for home-screen installation
│   ├── app.js                       # Modular loader & architecture guide
│   └── js/                          # 📦 Modular Single-Responsibility ES6 Modules
│       ├── state.js                 # Central state & DOM element caching
│       ├── audio-core.js            # Web Audio API graph & mic lifecycle
│       ├── voice-ws.js              # Server WebSocket & feedback-free router
│       ├── ptt.js                   # Walkie-Talkie Push-to-Talk interactions
│       ├── live-stream.js           # Live continuous conversion engine
│       ├── target-pc.js             # PC driver verification & routing config
│       ├── pc-audio.js              # PC sound downlink & 200ms jitter buffer
│       ├── room-calibrator.js       # Ambient noise calibration routine
│       ├── visualizer.js            # Canvas spectrum analyzer
│       ├── ui-controls.js           # Sliders, presets & mode listeners
│       └── main.js                  # Application bootstrap & window.VoiceMorph
├── receiver/
│   ├── target_receiver.py           # Cross-platform Virtual Mic daemon (port 8001)
│   ├── run_receiver_linux.sh        # PipeWire/Pulse virtual microphone launcher
│   └── run_receiver_windows.bat     # Windows VB-Audio virtual microphone launcher
├── models/
│   └── voices/
│       └── Noel_Vermillion/
│           ├── BlazBlue_Noel_Vermillion_English.pth     # Female voice weights
│           └── ..._v2.index                             # Feature index
├── server/
│   ├── config.py                    # Network discovery, constants & routing state
│   ├── target_client.py             # Target PC HTTP forwarder & health checker
│   ├── voice_engine.py              # Dual-Engine: PyWorld DSP + RVC CPU Inference
│   └── main.py                      # FastAPI + WebSocket server router & worker task
├── start_all.sh                     # Full-stack launcher (Server + Target PC Receiver)
├── start_server.sh                  # Dedicated Voice Changer server launcher
└── DOCUMENTATION.md                 # Master Architecture Documentation
└── DOCUMENTATION.md                 # Complete system documentation
```

---

## 7. How to Start & Use the System

### Option A: Single-Command Full Stack (Server + Receiver on Same PC)
If you want to use the voice changer on this laptop and speak through its microphone or into Discord on this same machine:
```bash
./start_all.sh
```
This automatically boots:
1. **Target PC Receiver** on `http://127.0.0.1:8001` (creates `VoiceMorph Virtual Microphone`).
2. **Voice Changer Server** on `https://192.168.1.2:8000` (HTTPS).

---

### Option B: Decoupled Multi-PC Setup (Server on Ryzen, Calls on Gaming PC)
If your voice changer server runs on your Ryzen laptop, but you are playing games or talking in Discord on a separate PC:

1. **On your Target PC (Gaming Desktop/Laptop)**:
   - Run the receiver agent:
     - **Linux**: `./receiver/run_receiver_linux.sh`
     - **Windows**: `receiver\run_receiver_windows.bat`
   - Note the Target PC's local Wi-Fi IP (e.g. `192.168.1.55`).
2. **On your Server Laptop (Ryzen 3500U)**:
   - Run the voice engine:
     ```bash
     ./start_server.sh
     ```
3. **On your Mobile Phone**:
   - Open Chrome/Safari and visit `https://192.168.1.2:8000`.
   - Tap **"Advanced" $\rightarrow$ "Proceed to 192.168.1.2"** to unlock microphone access.
   - Switch to the **🖥️ PC Virtual Mic** tab.
   - Enter your Target PC's IP (e.g. `192.168.1.55`) and tap **"Verify Driver & Connection"**.
   - The badge turns green: `🟢 Connected ✓ (Virtual Mic Ready)`.

---

### Configuring Discord / WhatsApp / Meet

1. Open **Discord** $\rightarrow$ **User Settings** $\rightarrow$ **Voice & Video**.
2. Set **Input Device** (Microphone) to:
   - **Linux**: `VoiceMorph Virtual Microphone`
   - **Windows**: `CABLE Output (VB-Audio Virtual Cable)`
3. Set **Input Sensitivity** to Automatic or $-50\text{ dB}$.
4. Speak into your mobile phone! Your converted female voice will stream directly into Discord!

---

## 8. Adding New Voice Models

You can add any custom RVC v1 or v2 model (`.pth` + `.index`):

1. Create a folder inside `models/voices/`:
   ```bash
   mkdir -p "models/voices/My_New_Character"
   ```
2. Copy your `.pth` and optional `.index` files into that directory:
   ```text
   models/voices/
     └── My_New_Character/
           ├── model.pth
           └── model.index
   ```
3. The server automatically scans `models/voices/` on startup and makes the new character selectable from the **Target Voice** dropdown menu on your phone!

---

## 9. Troubleshooting & FAQs

### Q: Why does the browser show "Your connection is not private"?
> This is normal for local development servers using self-signed SSL certificates. Because the certificate is generated specifically for your home Wi-Fi IP (`192.168.1.2`), commercial certificate authorities have not signed it. Tap **Advanced $\rightarrow$ Proceed** to safely continue.

### Q: Why do I not hear audio on my phone when Target PC is enabled?
> Check the **Audio Output Routing** toggles under the **🖥️ PC Virtual Mic** tab:
> - If **"Hear on Mobile Phone"** is turned OFF, audio flows directly to your Discord/WhatsApp virtual mic and remains silent on the phone. This prevents you from being distracted by hearing yourself while talking.
> - If you want to monitor your voice simultaneously, toggle **"Hear on Mobile Phone"** ON.

### Q: How can I change the pitch?
> Use the **Pitch Shift** slider on your phone:
> - `+11` or `+12`: Ideal for converting male vocal pitch to natural female pitch.
> - `0`: Natural pitch (same octave as your own voice).
> - `-12`: Lowers pitch by 1 octave (female to deep male).

### Q: Can I run this server in the background?
> Yes! You can run it under `tmux`, `nohup`, or `screen`:
> ```bash
> nohup ./start_all.sh > voicemorph.log 2>&1 &
> ```

---

## 10. PC-to-Mobile 48kHz Stereo Streaming & Dual Audio Profiles

### 10.1 Global System Audio Profiles (Call Mode vs Music Mode)
The client supports two distinct operating modes selectable with a single tap at the top of the interface:

| Profile | Target Use Case | Mobile OS Audio Route | Hardware Echo Cancellation (AEC) | Bandwidth & Fidelity |
| :--- | :--- | :--- | :--- | :--- |
| **📞 Call Mode** | Discord, WhatsApp, Walkie-Talkie | In-Call Telephony (`STREAM_VOICE_CALL`) / Ear Speaker | **Enabled (ON)** (prevents mic loopback) | Speech-optimized + 2.8kHz vocal clarity boost |
| **🎵 Music Mode** | Spotify, YouTube, Lossless PC Audio | Media Volume (`STREAM_MUSIC`) / Loudspeaker | **Disabled (OFF)** (zero ducking) | Studio-grade **48 kHz 16-bit Stereo** (pure bypass) |

### 10.2 Eradicating the Periodic Micro-Jitter "Tip" / "Click" Sound
In wireless Web Audio streaming, three engineering bottlenecks caused periodic audible "tip" transients:
1. **The 42.6ms PipeWire Batching Vacuum & Latency Flag:**
   * *Problem:* By default, `pw-record` flushed 8,192 bytes into the Linux pipe, but python read 4,096 bytes. This created an alternating sequence of a 42.6ms read stall followed by an immediate 0.02ms read burst, starving the mobile buffer 23.4 times every second.
   * *Solution:* Added `--latency=40ms` and `bufsize=0` to `pw-record`, and aligned chunks to exact 8,192-byte reads (2,048 stereo frames / 42.66ms). Arrival latency variance dropped to $\pm 0.11\text{ms}$ with metronomic regularity.
2. **The 16-Sample "De-Clicking" Waveform Notch Bug:**
   * *Problem:* Ramping the first 16 samples down to zero ($w[s] = 0.5(1 - \cos(\pi s / 16))$) on a continuous stream actively carved a hole in the waveform, plummeting healthy amplitude to 0.0 and generating the very click it intended to prevent.
   * *Solution:* Preserved 100% untouched waveform data. Never modify continuous PCM samples.
3. **Seamless Web Audio Hysteresis Scheduling:**
   * *Problem:* When naive buffer clocks drift or jitter occurs, resetting the schedule or jumping backwards causes buffer starvation and clicks.
   * *Solution:* Increased the jitter cushion to 200ms. Implemented monotonic schedule tracking: `const startAt = Math.max(now, pcAudioNextTime); source.start(startAt); pcAudioNextTime = startAt + audioBuf.duration;`. If a packet arrives slightly late ($<150\text{ms}$), it plays immediately without void or schedule destruction.
4. **Exact Pipe Alignment on Linux PipeWire (`read_exact_bytes`):**
   * *Problem:* Standard `stream.read(4096)` on Linux pipes can return partial byte counts (e.g., 2,050 bytes), breaking the 4-byte stereo frame boundary (2 channels $\times$ 2 bytes) and swapping Left/Right channels.
   * *Solution:* `read_exact_bytes` buffers pipe input until an exact 8,192-byte chunk (2,048 stereo frames) is ready before transmission over WebSocket.

### 10.3 Troubleshooting "Connecting..." Freeze Trap
* **Symptom:** The phone loads the page but remains permanently frozen showing "Connecting...", and no WebSocket request appears in the server log.
* **Root Cause:** A JavaScript syntax or scope error (e.g., duplicate `const source` declaration inside an audio node handler) halts the browser's JavaScript engine during script compilation. Because parsing aborts before any executable code runs, `initApp()` and `connectWebSocket()` are never reached, leaving the status badge stuck on its static HTML placeholder.
* **Resolution:** Removed the redundant `const source` declaration in `playPcAudioChunk`, installed a global `window.onerror` fallback logger to immediately display any parsing or runtime errors in the mobile console, and applied cache-busting version query parameters (`?v=...`) to force instant browser reload.
