# 🌐 AudioMesh: Low-Latency Distributed Audio Network & Virtual Studio Architecture

A high-performance, full-duplex distributed audio networking framework and virtual studio engine engineered for the **AMD Ryzen 5 3500U (Vega 8 / 8GB RAM)** with a low-latency mobile Progressive Web App (PWA) client, multi-device synchronized audio broadcast, and real-time neural DSP processing.

---

## 📑 Table of Contents
1. [Project Overview & Distributed Audio Mesh Architecture](#1-project-overview--distributed-audio-mesh-architecture)
2. [The Multi-Device Wireless Audio Challenge & Solutions (Downlink)](#2-the-multi-device-wireless-audio-challenge--solutions-downlink)
   - [The Bluetooth A2DP 1-to-1 Bottleneck & Clock Drift](#the-bluetooth-a2dp-1-to-1-bottleneck--clock-drift)
   - [The Wi-Fi Mesh Solution: 48kHz Stereo Broadcast](#the-wi-fi-mesh-solution-48khz-stereo-broadcast)
   - [Eradicating Periodic Micro-Jitter "Clicks" & Achieving 45ms Lip-Sync](#eradicating-periodic-micro-jitter-clicks--achieving-45ms-lip-sync)
3. [Decoupled 3-Tier Virtual Microphone Architecture (Uplink)](#3-decoupled-3-tier-virtual-microphone-architecture-uplink)
   - [The Decoupled Two-Way Model](#the-decoupled-two-way-model)
   - [Target PC Virtual Mic Receiver (Linux PipeWire & Windows WASAPI)](#target-pc-virtual-mic-receiver-linux-pipewire--windows-wasapi)
   - [Acoustic & Electrical Feedback Loop Prevention](#acoustic--electrical-feedback-loop-prevention)
   - [Live Connection Verification & Diagnostics](#live-connection-verification--diagnostics)
4. [Hardware Remote Control & Operating System Bridge](#4-hardware-remote-control--operating-system-bridge)
   - [Linux DBus (MPRIS v2) & Windows Virtual Keys](#linux-dbus-mpris-v2--windows-virtual-keys)
   - [Mobile MediaSession, Lock-Screen & Headphone Hardware Debounce](#mobile-mediasession-lock-screen--headphone-hardware-debounce)
5. [Network & Audio Streaming Pipeline](#5-network--audio-streaming-pipeline)
   - [Asynchronous Decoupled Queue](#asynchronous-decoupled-queue)
   - [Mobile HTTPS & SSL with Subject Alternative Name (SAN)](#mobile-https--ssl-with-subject-alternative-name-san)
6. [Client-Side Modular Web Audio Architecture](#6-client-side-modular-web-audio-architecture)
   - [ES6 Modular Subsystem Breakdown](#es6-modular-subsystem-breakdown)
   - [Global Profiles: Call Mode (AEC) vs Music Mode (Hi-Fi Stereo)](#global-profiles-call-mode-aec-vs-music-mode-hi-fi-stereo)
7. [Creative DSP & Neural Voice Conversion Engine (Challenges & Optimization)](#7-creative-dsp--neural-voice-conversion-engine-challenges--optimization)
   - [The Heavy Neural Network Challenge on Low-Power Mobile CPUs](#the-heavy-neural-network-challenge-on-low-power-mobile-cpus)
   - [Dual-Engine Hybrid: Instant DSP vs Deep Neural RVC](#dual-engine-hybrid-instant-dsp-vs-deep-neural-rvc)
   - [Acoustic Physics & Mathematical Formulations (F0 & Formant Rescaling)](#acoustic-physics--mathematical-formulations-f0--formant-rescaling)
   - [Engine B: RVC Neural Network Architecture & CPU Acceleration](#engine-b-rvc-neural-network-architecture--cpu-acceleration)
   - [Bi-Directional Pitch Transformation (-12 Deep Male to +12 Bright Female)](#bi-directional-pitch-transformation--12-deep-male-to-12-bright-female)
8. [Directory & File Structure](#8-directory--file-structure)
9. [How to Start & Use the System](#9-how-to-start--use-the-system)
10. [Troubleshooting & FAQs](#10-troubleshooting--faqs)

---

## 1. Project Overview & Distributed Audio Mesh Architecture

### The Core Problem
Operating systems (Windows, Linux, macOS) are fundamentally built for single-user, single-headset audio output. Consumers who want to:
1. Share live PC audio across multiple wireless headphones simultaneously (for silent group movie watching or gaming),
2. Use a mobile phone as a zero-latency wireless microphone for Discord, Zoom, or games without physical tethering, and
3. Apply real-time creative voice transformations and remote control without specialized hardware soundboards,

are traditionally forced to purchase expensive proprietary ecosystems (e.g. Apple AirPods Audio Sharing) or complex hardware splitters.

### The AudioMesh Solution
AudioMesh establishes an **interconnected audio fabric over local Wi-Fi**:
* **The Host Workstation** acts as the audio hub, capturing desktop playback (downlink) and exposing virtual microphones (uplink).
* **Mobile Devices** act as autonomous wireless edge nodes running a high-performance Web Audio engine in the browser.
* **Low-Latency Neural Audio Processing** runs centrally on the host CPU, offloading heavy computations from mobile batteries.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   📱 MOBILE CLIENTS (Wireless Mesh Nodes)                   │
│  • Node A (45ms Video Lip-Sync) • Node B (Shared Movie/Music Listener)     │
│  • Node C (Wireless Microphone & Headphone Remote Controller)               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ WebSocket (TLS / Binary PCM)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   💻 AUDIOMESH SERVER (AMD Ryzen 3500U Host)                │
│  • Asynchronous Decoupled I/O Hub (< 1ms keepalive responses)               │
│  • Creative Studio: Dual-Engine DSP / Neural Speech Transformation          │
│  • Bidirectional Proxy & State Synchronization                             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Inter-Process Pipe / Loopback
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   🖥️ OPERATING SYSTEM AUDIO SINK & SOURCE                   │
│  • Linux PipeWire Graph (pw-record, pw-loopback, DBus MPRIS v2)             │
│  • Windows WASAPI Subsystem (WASAPI Loopback, soundcard, VB-Cable)          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Hardware Constraints & Solutions

| Hardware Component | Spec & Limitations | Engineering Solution |
| :--- | :--- | :--- |
| **CPU** | AMD Ryzen 5 3500U (4 cores / 8 threads, Zen+ Mobile) | Thread contention avoided by pinning PyTorch and audio threads to physical cores (`OMP_NUM_THREADS=4`). |
| **GPU** | Radeon Vega 8 iGPU (gfx902) — ROCm unsupported on Linux | Complete inference engine runs on CPU utilizing AVX2 vectorized arithmetic and FAISS nearest-neighbor bypass. |
| **RAM** | 8 GB total (~5.7 GB usable, remainder reserved for VRAM) | Headless FastAPI backend; zero desktop GUI overhead; offline model caching. |
| **Multi-Device Sync** | Packet jitter variance across 2.4GHz & 5GHz Wi-Fi | Raised-cosine adaptive jitter cushion; independent client audio hysteresis schedulers. |

---

## 2. The Multi-Device Wireless Audio Challenge & Solutions (Downlink)

### The Bluetooth A2DP 1-to-1 Bottleneck & Clock Drift
Traditional Bluetooth audio relies on the **A2DP (Advanced Audio Distribution Profile)**, which is architecturally restricted to point-to-point (1-to-1) connections.
Furthermore, every wireless earphone relies on an independent hardware crystal oscillator. Without hardware IEEE-1588 time stamping, two Bluetooth earphones connected to the same host drift out of phase within 30 seconds, generating an unlistenable echo.

### The Wi-Fi Mesh Solution: 48kHz Stereo Broadcast
AudioMesh bypasses Bluetooth hardware limitations by offloading the transport layer to the local Wi-Fi router ($100\times$ higher bandwidth than Bluetooth):
1. The host PC captures speaker audio directly from the primary output sink in native **48 kHz 16-bit Stereo PCM**.
2. Each mobile client connects via a dedicated binary WebSocket stream.
3. Audio is rendered through the browser's hardware-accelerated Web Audio pipeline (`AudioContext`), allowing each user to use their own earphones without physical audio splitters.

### Eradicating Periodic Micro-Jitter "Clicks" & Achieving 45ms Lip-Sync
In wireless real-time audio, network packet arrival is non-deterministic. Naive implementations suffer from audible clicks and buffer starvation. AudioMesh implements a 4-part stabilization architecture:

1. **PipeWire Quantum Alignment & Latency Matching:**
   * *Problem:* PipeWire buffered 8,192 bytes while python read 4,096 bytes, creating alternating 42.6ms stalls and burst read cycles that starved the client buffer 23.4 times per second.
   * *Solution:* Configured `pw-record` with `--latency=20ms` and `bufsize=0`, aligning reads to exact frame boundaries.
2. **Elimination of Waveform Notching:**
   * *Problem:* Arbitrary sample windowing on continuous audio streams carves amplitude holes down to zero, generating audible step clicks.
   * *Solution:* Maintained 100% bit-perfect continuous PCM streaming, restricting fades strictly to underrun recovery boundaries.
3. **Adaptive Raised-Cosine Gap Recovery (1.5ms):**
   * When a Wi-Fi packet is delayed, the scheduler plays the packet immediately at `AudioContext.currentTime` with zero artificial silence hole, applying a 1.5ms raised-cosine ramp ($w[i] = 0.5(1 - \cos(\pi i / N))$) to eliminate DC step transients.
4. **Transparent Peak Limiter for Music Mode:**
   * An ultrafast 1ms attack dynamics compressor with a $-0.5\text{ dB}$ threshold prevents loud speech bursts from clipping mobile digital-to-analog converters (DACs).

---

## 3. Decoupled 3-Tier Virtual Microphone Architecture (Uplink)

### The Decoupled Two-Way Model
In standard setups, microphones must be physically connected to the computer running the target software (Discord, WhatsApp, Zoom). AudioMesh decouples the microphone from the host workstation:
* **Uplink**: Mobile phone captures human speech, converts it in real time, and transmits it across the LAN into a **Virtual Microphone**.
* **Downlink**: Host workstation streams meeting/game/call audio back to the phone earphones.
* **Result**: Complete two-way wireless communication with zero cables.

### Target PC Virtual Mic Receiver (Linux PipeWire & Windows WASAPI)
The receiver daemon ([`receiver/target_receiver.py`](file:///home/mathavan/Documents/voice%20changer%20/receiver/target_receiver.py)) operates as a standalone service on port `8001`:
* **Linux (PipeWire / WirePlumber)**:
  * Dynamically creates a virtual loopback device pair (`pw-loopback`):
    * **`VoiceMorph_Sink`** (`media.class=Audio/Sink`): Ingests converted audio from the network.
    * **`VoiceMorph_Mic`** (`media.class=Audio/Source`): Exposes native capture ports that Discord, Chrome, and Zoom automatically enumerate as a physical microphone.
* **Windows (WASAPI & VB-Audio Cable)**:
  * Automatically provisions `CABLE Input` and `CABLE Output` via silent driver installation scripts ([`install_vbcable.bat`](file:///home/mathavan/Documents/voice%20changer%20/receiver/install_vbcable.bat)). Converted audio feeds `CABLE Input`, and Discord listens on `CABLE Output`.

### Acoustic & Electrical Feedback Loop Prevention
Feedback loops occur when microphone input is routed back into the speaker, re-entering the microphone in an escalating screech. AudioMesh prevents this through structural isolation:
1. **Target PC feeds ONLY the Virtual Mic Sink**: Converted audio is routed strictly into the virtual input device. It is never routed to the host workstation's physical speakers.
2. **Decoupled Mode Separation**:
   * **Live Streaming Mode**: The mobile phone does not play the user's converted voice back into the phone earphones, making a local loop 100% physically impossible while allowing the user to simultaneously listen to PC audio.
   * **Walkie-Talkie (PTT) Mode**: Half-duplex operation. The microphone records while held; on release, recording halts before playback begins, guaranteeing zero acoustic feedback.

---

## 4. Hardware Remote Control & Operating System Bridge

### Linux DBus (MPRIS v2) & Windows Virtual Keys
AudioMesh bridges mobile user actions directly to the host desktop environment:
* **Linux**: Communicates over user DBus with `org.mpris.MediaPlayer2.*` interfaces (Brave, Spotify, VLC). Supports playback inspection (`PlaybackStatus`, `Metadata`), track skipping (`Next`, `Previous`), and intelligent history fallback for standalone YouTube videos.
* **Windows**: Dispatches native virtual key codes (`VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK`, `VK_MEDIA_PREV_TRACK`) via `ctypes.windll.user32.keybd_event`.

### Mobile MediaSession, Lock-Screen & Headphone Hardware Debounce
Mobile browsers (Android Chrome) often drop background audio focus. AudioMesh solves this using a multi-layer integration:
1. **Audible Keeper Audio Element**: A background `<audio>` element playing an inaudible sub-bass carrier ($30\text{Hz}$ at $-54\text{ dBFS}$) keeps Chrome's `AudioStreamMonitor` active, preventing mobile OS task-killers from putting the tab to sleep.
2. **450ms Hardware Anti-Bounce Lock**:
   * *Problem:* Android Chrome emits `navigator.mediaSession.setActionHandler("pause")`, the audio element's `.onpause`, and keycode 179 simultaneously on a single headphone click, causing toggle flapping (pause followed by instant resume).
   * *Solution:* Implemented an atomic 450ms hardware debounce window and distinct idempotent semantic actions (`pause` vs `play`), eliminating rapid toggle flapping.
3. **Synchronized Playback State**: Pausing the target PC media synchronously pauses the local keeper element, ensuring the Android lock screen accurately flips between ▶ Play and ⏸ Pause.

---

## 5. Network & Audio Streaming Pipeline

### Asynchronous Decoupled Queue
Running synchronous neural network inference blocks the event loop. AudioMesh decouples network I/O from compute worker tasks:

```
[ WebSocket Receive Loop ] ──(Ping)───> Replies "pong" in < 0.1ms (Zero connection drops)
           │
       (PCM Bytes)
           │
           ▼
  [ asyncio.Queue(10) ]
           │
           ▼
[ Dedicated CPU Worker ] ────(Thread)──> Executes VoiceEngine DSP/RVC pipeline
           │
           ▼
   [ Stream Output ] ─────────> Dispatches converted audio frames to destination
```

### Mobile HTTPS & SSL with Subject Alternative Name (SAN)
Modern mobile browsers disable `navigator.mediaDevices.getUserMedia` on insecure HTTP connections.
AudioMesh generates self-signed certificates containing Subject Alternative Name (SAN) IP extensions:
```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/key.pem -out certs/cert.pem -days 365 \
  -subj "/CN=192.168.1.6" \
  -addext "subjectAltName=IP:192.168.1.6,IP:127.0.0.1,DNS:localhost"
```
This enables the standard Chrome **"Advanced $\rightarrow$ Proceed to 192.168.1.X"** bypass, unlocking persistent microphone access in a Secure Context.

---

## 6. Client-Side Modular Web Audio Architecture

The client is built on an enterprise-grade ES6 modular architecture in `client/js/`:

```
📁 client/js/
├── state.js           - Central reactive state store, DOM cache & telemetry
├── audio-core.js      - Web Audio API graph, microphone lifecycle & AEC controls
├── voice-ws.js        - Conversion WebSocket /ws, heartbeat & routing dispatcher
├── ptt.js             - Walkie-Talkie Push-to-Talk gestures & PCM chunking
├── live-stream.js     - Real-time continuous live streaming engine
├── target-pc.js       - Virtual Mic driver verification & routing configuration
├── pc-audio.js        - PC audio downlink /ws/pc_audio & 45ms jitter buffer
├── media-session.js   - Web MediaSession API, lock-screen controls & hardware debounce
├── room-calibrator.js - 1.5-second ambient room noise calibration engine
├── visualizer.js      - Real-time audio frequency spectrum analyzer
├── ui-controls.js     - Sliders, voice transform presets & mode navigation
└── main.js            - Application bootstrap & developer console diagnostics
```

---

## 7. Creative DSP & Neural Voice Conversion Engine (Challenges & Optimization)

### The Heavy Neural Network Challenge on Low-Power Mobile CPUs
Running deep generative models (HuBERT + VITS HiFi-GAN) in real time on an entry-level mobile processor (AMD Ryzen 5 3500U, 15W TDP, 4 physical cores, no dedicated N-card or ROCm support) represents an extreme computational challenge:
* Standard RVC pipelines require **$8\text{–}12\text{ seconds}$** per audio chunk on CPU, making live conversation impossible.
* AudioMesh solves this through a **Dual-Engine Hybrid Architecture**: an ultra-fast $0.2\text{s}$ Vocoder DSP engine for instant communication, paired with an aggressively optimized RVC neural engine for voice cloning.

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
• Formant Rescaling (alpha=1.16)             • FAISS Bypass (index=0.0)
• Pitch Shift (-12 to +24 semitones)         • VITS / HiFi-GAN Generative Decoder
• Latency: ~0.20s (Sub-second)               • Latency: ~4.5s – 6.0s
          │                                                 │
          └────────────────────────┬────────────────────────┘
                                   │
                                   ▼
                [ Converted Audio Stream to Destination ]
```

### Acoustic Physics & Mathematical Formulations

Human vocal registers differ across two primary acoustic dimensions:
1. **Fundamental Frequency ($F_0$)**: Vocal cord vibration rate (typically $85\text{–}155\text{ Hz}$ for adult males, $165\text{–}255\text{ Hz}$ for adult females).
2. **Vocal Tract Formants ($F_1, F_2, F_3$)**: The acoustic resonance frequencies of the vocal tract (averaging $\sim 14.5\text{ cm}$ in females vs $\sim 17.5\text{ cm}$ in males, an approximate $16\%$ difference).

Shifting pitch alone produces an unnatural "chipmunk" effect. The PyWorld vocoder transforms both dimensions simultaneously:

$$\text{Pitch Shift: } F_{0,\text{target}}(t) = F_{0,\text{source}}(t) \cdot 2^{\frac{\Delta \text{semitones}}{12}}$$

$$\text{Formant Rescaling: } S_{\text{target}}(\omega) = S_{\text{source}}\left(\frac{\omega}{\alpha}\right)$$

Where $\alpha = 1.16$ rescales formants for feminine vocal tracts, and $\alpha = 0.86$ expands formants for masculine vocal tracts.

### Engine B: RVC Neural Network Architecture & CPU Acceleration
1. **Semantic Feature Extractor (HuBERT Base)**: 12-layer Transformer model (95M parameters) extracting 768-dimensional phonetic vectors (`hidden_states`), isolating linguistic content from speaker identity.
2. **Pitch Predictor (Parselmouth / PM)**: Autocorrelation-based pitch tracking.
3. **VITS HiFi-GAN Synthesizer**: Conditional variational autoencoder with adversarial flow layers.

#### CPU Acceleration Techniques on Ryzen 3500U:
* **FAISS Vector Search Bypass (`index_influence = 0.0`)**: Eliminates the nearest-neighbor CPU search across the 77MB index file, saving **$2\text{ to }4\text{ seconds}$** per chunk.
* **Low-Latency Padding (`t_pad = 2400`)**: Reduced from RVC's default 16,000 samples down to 2,400 samples ($0.15\text{s}$), cutting neural computation by **$\sim 35\%$**.
* **Offline Caching (`HF_HUB_OFFLINE=1`)**: Eliminates remote DNS validation timeouts.

### Bi-Directional Pitch Transformation
AudioMesh supports universal bi-directional vocal adaptation via 1-click presets:
* 🧔 **Deep Male Broadcast (`-12 semitones`)**: Drops an entire octave, transforming female or high-register speech into a resonant masculine broadcast tone.
* 🎙️ **Studio Natural (`0 semitones`)**: Natural pitch passthrough with vocal formant enhancement.
* 👧 **Bright Female (`+12 semitones`)**: Shifts vocal cords up an octave for feminine transformation.

---

## 8. Directory & File Structure

```text
AudioMesh/
├── certs/                           # SSL certificate with Subject Alternative Name (SAN)
│   ├── cert.pem                     # Local HTTPS certificate
│   └── key.pem                      # Private key
├── client/                          # Mobile Progressive Web App (PWA)
│   ├── index.html                   # AudioMesh Studio interface
│   ├── styles.css                   # Cyber-glow dark UI with glassmorphism & visualizer
│   ├── manifest.json                # PWA manifest
│   ├── silent_keeper.wav            # 48kHz sub-audible keeper maintaining mobile audio focus
│   ├── icon-*.png                   # Android NotificationCompat lock-screen icons
│   └── js/                          # Modular ES6 Subsystems
│       ├── state.js                 # Central reactive state & DOM cache
│       ├── audio-core.js            # Web Audio API graph & AEC lifecycle
│       ├── voice-ws.js              # WebSocket communication layer
│       ├── ptt.js                   # Walkie-Talkie Push-to-Talk gestures
│       ├── live-stream.js           # Live continuous audio stream
│       ├── target-pc.js             # PC virtual mic driver verification
│       ├── pc-audio.js              # 45ms jitter-buffered audio downlink
│       ├── media-session.js         # MediaSession API & hardware debounce
│       ├── room-calibrator.js       # Ambient noise calibration
│       ├── visualizer.js            # Real-time audio spectrum analyzer
│       ├── ui-controls.js           # Sliders, presets & navigation
│       └── main.js                  # Application bootstrap & window.VoiceMorph
├── receiver/                        # Target PC Audio Receiver (Port 8001)
│   ├── target_receiver.py           # Cross-platform PipeWire / WASAPI receiver
│   ├── install_vbcable.bat          # Automated 1-click Windows driver installer
│   ├── run_receiver_linux.sh        # Linux PipeWire virtual mic launcher
│   └── run_receiver_windows.bat     # Windows VB-Audio launcher
├── models/                          # Neural speech model weights (.pth + .index)
├── server/                          # Host Server (Port 8000)
│   ├── config.py                    # Network discovery & routing state
│   ├── target_client.py             # Target PC HTTP forwarder
│   ├── voice_engine.py              # Dual-Engine: PyWorld DSP + RVC CPU Inference
│   └── main.py                      # FastAPI + WebSocket server router & worker task
├── start_all.sh                     # Full-stack launcher (Server + Receiver)
├── start_server.sh                  # Dedicated Voice Changer server launcher
├── AGENTS.md                        # Universal Human-AI Engineering & Mentorship Protocol
├── README.md                        # Master Project Overview & Quick Start
└── DOCUMENTATION.md                 # Master Technical Architecture Documentation
```

---

## 9. How to Start & Use the System

### Single-Command Launch (Linux Host)
```bash
./start_all.sh
```
This automatically boots:
1. **Target PC Receiver** on `http://127.0.0.1:8001` (provisions `VoiceMorph Virtual Microphone`).
2. **AudioMesh Studio Server** on `https://192.168.1.6:8000` (HTTPS).

### Connecting Mobile Devices
1. Connect mobile phone(s) to the **same local Wi-Fi**.
2. Open Chrome or Safari and visit:
   ```text
   https://192.168.1.6:8000
   ```
3. Tap **"Advanced $\rightarrow$ Proceed to 192.168.1.X"** on the self-signed certificate warning.
4. Tap **"Start Listening to PC Audio"** to join the audio mesh!
5. In **Discord**, set Microphone / Input Device to **"VoiceMorph Virtual Microphone"** (Linux) or **"CABLE Output"** (Windows).

---

## 10. Troubleshooting & FAQs

### Q: Why does the browser show "Your connection is not private"?
> Self-signed SSL certificates generated for local development are not signed by commercial certificate authorities. The certificate contains Subject Alternative Name (SAN) IP extensions specifically allowing Chrome to display the standard **Advanced $\rightarrow$ Proceed** bypass button.

### Q: How do multiple phones hear PC audio in sync?
> The server streams identical 48 kHz stereo PCM frames over concurrent WebSocket connections. Each mobile client maintains an adaptive raised-cosine jitter buffer, providing synchronized multi-earphone listening.

### Q: How do I switch between male and female vocal conversion?
> Under the Voice Settings panel, tap **🧔 Deep Male (-12)** to drop an octave for a deep broadcast voice, or **👧 Bright Female (+12)** to shift up an octave for feminine vocal transformation. Tap **🎙️ Studio (0)** for natural clean passthrough.

### Q: Can AudioMesh run in the background on the host PC?
> Yes:
> ```bash
> nohup ./start_all.sh > audiomesh.log 2>&1 &
> ```
