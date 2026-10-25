# 🎙️ VoiceMorph - Dual-Engine Mobile Voice Changer Server

An AI & DSP hybrid voice conversion server engineered specifically for the **AMD Ryzen 5 3500U** with a low-latency mobile Progressive Web App (PWA) client and **decoupled Virtual Microphone routing for Discord, WhatsApp, and Games**.

---

## ⚡ Key Highlights

- **Two-Way Wireless Headset Architecture**:
  - **Uplink (Wireless Mic)**: Use your mobile phone freely as a wireless microphone. The server converts your voice in ~0.2s and feeds it into the **Target PC Virtual Microphone** (`VoiceMorph Virtual Microphone`) for Discord / WhatsApp calls.
  - **Downlink (Hear PC Calls on Phone)**: Live streams whatever the other people in Discord/WhatsApp say on the Target PC directly to your mobile phone earphones with volume control. Walk anywhere on Wi-Fi with complete two-way freedom!
  - **Decoupled 3-Tier Design**: Target PC can be the same laptop or any desktop on your local network listening on port `8001`.
  - Built-in connection verification with live status indicator (`🟢 Connected` / `🔴 Offline`).
  - Zero acoustic feedback loops: Target PC receiver feeds only the virtual microphone sink, never the physical speakers.
- **Dual-Engine Architecture**:
  - **⚡ Instant Fast Mode (~0.2s)**: Real-time high-fidelity vocoder DSP (PyWorld). Shifts pitch $+11$ semitones and scales vocal tract formants $1.16\times$ for immediate female transformation with **zero perceptible delay**.
  - **🧠 RVC Neural AI Mode (~5s–7s)**: Deep neural voice conversion (HuBERT + VITS HiFi-GAN) for character-specific voice cloning (**Noel Vermillion**).
- **Mobile-First Experience**:
  - Open on your mobile phone browser (Chrome/Safari) via HTTPS.
  - **Walkie-Talkie (Push-to-Talk)**, **Live Stream**, and **PC Virtual Mic** setup tabs.
  - Audio destination controls: stream to PC Virtual Mic, phone speaker, or both.
  - Real-time Audio Visualizer, on-screen diagnostic log, and latency monitor.
- **Ryzen 3500U Optimizations**:
  - Multi-threaded CPU parallelization (`OMP_NUM_THREADS=4`).
  - Low-latency padding (`t_pad = 2400`).
  - Asynchronous decoupled WebSocket queue (pings responded to in $<1\text{ms}$).

---

## 🚀 Quick Start

### 1. Launch the Stack (Server + Virtual Mic Receiver)
On your laptop, run:
```bash
./start_all.sh
```
This starts:
- Target PC Virtual Mic Receiver on `http://127.0.0.1:8001`
- Voice Changer Web App on `https://192.168.1.2:8000`

*(To run the receiver on another PC on Wi-Fi, run `./receiver/run_receiver_linux.sh` or `receiver\run_receiver_windows.bat` on that PC)*.

### 2. Connect Your Mobile Phone
1. Connect your phone to the **same Wi-Fi network**.
2. Open Chrome/Safari and visit:
   ```text
   https://192.168.1.2:8000
   ```
3. Tap **"Advanced" $\rightarrow$ "Proceed to 192.168.1.2"** on the SSL prompt.
4. Allow microphone access when prompted.
5. In the **"🖥️ PC Virtual Mic"** tab, verify the target PC connection (turns `🟢 Connected`).
6. In **Discord** or **WhatsApp**, set Microphone / Input Device to **"VoiceMorph Virtual Microphone"**.
7. Speak into your mobile phone! Your converted voice will flow live into Discord!

---

## 📖 In-Depth Documentation

For full details on the mathematical formulations, PyWorld formant scaling, neural network architecture, and code layout, please read:
👉 **[DOCUMENTATION.md](DOCUMENTATION.md)**
