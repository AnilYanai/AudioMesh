/**
 * @file pc-audio.js
 * @description Wireless Target PC audio downlink (Desktop/Discord/Call stream to phone headphones),
 *              adaptive 200ms jitter cushion, and Call vs Music mode Web Audio DSP filters.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, logEvent } from './state.js';
import { getAudioContext } from './audio-core.js';
import { startBackgroundKeepAlive, stopBackgroundKeepAlive } from './background-keepalive.js';

// ==========================================
// 1. Web Audio DSP Graph (Call Mode vs Pure Stereo)
// ==========================================

export function initPcAudioGraph() {
  const ctx = getAudioContext();

  if (!state.pcAudio.gainNode) {
    state.pcAudio.gainNode = ctx.createGain();
    state.pcAudio.gainNode.gain.value = state.pcAudio.volume;
    state.pcAudio.gainNode.connect(ctx.destination);
  }

  // 1. 85Hz Low-Cut Highpass: removes desk rumbles, fan drone, and mic handling thumps from peers
  if (!state.pcAudio.highpassNode) {
    state.pcAudio.highpassNode = ctx.createBiquadFilter();
    state.pcAudio.highpassNode.type = "highpass";
    state.pcAudio.highpassNode.frequency.value = 85;
    state.pcAudio.highpassNode.Q.value = 0.707;
  }

  // 2. 2.8kHz Vocal Presence Lift (+3.5 dB): brings consonants ('s', 't', 'k') forward
  if (!state.pcAudio.presenceNode) {
    state.pcAudio.presenceNode = ctx.createBiquadFilter();
    state.pcAudio.presenceNode.type = "peaking";
    state.pcAudio.presenceNode.frequency.value = 2800;
    state.pcAudio.presenceNode.gain.value = 3.5;
    state.pcAudio.presenceNode.Q.value = 1.0;
  }

  // 3. Dynamic Speech Compressor: levels quiet callers while catching loud screams
  if (!state.pcAudio.compressorNode) {
    state.pcAudio.compressorNode = ctx.createDynamicsCompressor();
    state.pcAudio.compressorNode.threshold.value = -24; // dB
    state.pcAudio.compressorNode.knee.value = 10;       // dB
    state.pcAudio.compressorNode.ratio.value = 4.0;
    state.pcAudio.compressorNode.attack.value = 0.005;  // 5ms
    state.pcAudio.compressorNode.release.value = 0.150; // 150ms
  }

  relinkPcAudioGraph();
}

export function relinkPcAudioGraph() {
  if (!state.pcAudio.gainNode || !state.audioContext) return;

  try {
    if (state.pcAudio.highpassNode) state.pcAudio.highpassNode.disconnect();
    if (state.pcAudio.presenceNode) state.pcAudio.presenceNode.disconnect();
    if (state.pcAudio.compressorNode) state.pcAudio.compressorNode.disconnect();
  } catch (e) {}

  if (state.globalAudioMode === "call") {
    // 📞 Call Mode DSP Chain:
    // Input -> Highpass (85Hz) -> Presence (+3.5dB @ 2.8kHz) -> Compressor -> Gain -> Destination
    state.pcAudio.highpassNode.connect(state.pcAudio.presenceNode);
    state.pcAudio.presenceNode.connect(state.pcAudio.compressorNode);
    state.pcAudio.compressorNode.connect(state.pcAudio.gainNode);
    state.pcAudio.inputNode = state.pcAudio.highpassNode;
  } else {
    // 🎵 Music Mode: 100% Pure Untouched Hi-Fi Stereo Bypass -> Gain -> Destination
    state.pcAudio.inputNode = state.pcAudio.gainNode;
  }
}

// ==========================================
// 2. UI Status Badges
// ==========================================

export function updatePcAudioUI(active) {
  if (elements.pcAudioBadge) {
    elements.pcAudioBadge.className = active ? "verify-badge verified" : "verify-badge unverified";
  }
  if (elements.pcAudioBadgeText) {
    elements.pcAudioBadgeText.textContent = active ? "Listening 🔊" : "Muted";
  }
  if (elements.pillHearPcStatus) {
    elements.pillHearPcStatus.textContent = active ? "🎧 Hear PC: ON" : "🎧 Hear PC: OFF";
    elements.pillHearPcStatus.className = active ? "pill-badge active" : "pill-badge disabled";
  }
  if (elements.btnTogglePcAudio) {
    if (active) {
      elements.btnTogglePcAudio.classList.add("active");
      if (elements.btnPcAudioIcon) elements.btnPcAudioIcon.textContent = "⏹";
      if (elements.btnPcAudioText) elements.btnPcAudioText.textContent = "Stop Listening to PC Audio";
    } else {
      elements.btnTogglePcAudio.classList.remove("active");
      if (elements.btnPcAudioIcon) elements.btnPcAudioIcon.textContent = "▶";
      if (elements.btnPcAudioText) elements.btnPcAudioText.textContent = "Start Listening to PC Audio";
    }
  }
}

// ==========================================
// 3. Audio Streaming Lifecycle
// ==========================================

export async function startPcAudioListening() {
  if (state.pcAudio.isListening) return;

  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  initPcAudioGraph();
  state.pcAudio.isFirstChunk = true;
  state.pcAudio.nextPlayTime = 0;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/pc_audio`;

  logEvent(`Connecting to PC Audio stream at ${wsUrl}...`, "highlight");

  try {
    state.pcAudio.ws = new WebSocket(wsUrl);
    state.pcAudio.ws.binaryType = "arraybuffer";

    state.pcAudio.ws.onopen = () => {
      state.pcAudio.isListening = true;
      state.pcAudio.isFirstChunk = true;
      state.pcAudio.nextPlayTime = 0;
      updatePcAudioUI(true);
      startBackgroundKeepAlive();
      logEvent("🎧 Connected! Target PC audio is streaming in high-definition.", "success");
    };

    state.pcAudio.ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const meta = JSON.parse(event.data);
          if (meta.type === "stream_info") {
            state.pcAudio.sampleRate = meta.sample_rate || 48000;
            state.pcAudio.channels = meta.channels || 2;
            if (elements.pcAudioFmtBadge) {
              elements.pcAudioFmtBadge.textContent = `${(state.pcAudio.sampleRate / 1000).toFixed(0)}kHz ${state.pcAudio.channels === 2 ? 'Stereo' : 'Mono'}`;
            }
          }
        } catch (e) {}
      } else if (event.data instanceof ArrayBuffer && state.pcAudio.isListening) {
        playPcAudioChunk(event.data);
      }
    };

    state.pcAudio.ws.onclose = () => {
      state.pcAudio.isListening = false;
      updatePcAudioUI(false);
      logEvent("Target PC Audio stream disconnected.", "warn");
    };

    state.pcAudio.ws.onerror = (e) => {
      logEvent("Target PC Audio stream error. Check if target receiver is running.", "error");
      stopPcAudioListening();
    };
  } catch (err) {
    logEvent(`Could not connect to PC Audio stream: ${err.message}`, "error");
    stopPcAudioListening();
  }
}

export function stopPcAudioListening() {
  state.pcAudio.isListening = false;
  if (state.pcAudio.ws) {
    try { state.pcAudio.ws.close(); } catch(e) {}
    state.pcAudio.ws = null;
  }
  updatePcAudioUI(false);
  if (!state.isLiveStreaming) {
    stopBackgroundKeepAlive();
  }
  logEvent("Stopped listening to Target PC audio.");
}

export function togglePcAudioListening() {
  if (state.pcAudio.isListening) {
    stopPcAudioListening();
  } else {
    startPcAudioListening();
  }
}

// ==========================================
// 4. Jitter-Buffered Audio Playback Worker
// ==========================================

export function playPcAudioChunk(arrayBuffer) {
  const ctx = getAudioContext();
  if (!ctx || !state.pcAudio.isListening || !state.pcAudio.inputNode) return;

  const int16Array = new Int16Array(arrayBuffer);
  const channels = state.pcAudio.channels || 2;
  const sampleRate = state.pcAudio.sampleRate || 48000;
  const frameCount = Math.floor(int16Array.length / channels);
  if (frameCount <= 0) return;

  const audioBuf = ctx.createBuffer(channels, frameCount, sampleRate);

  if (channels === 2) {
    // Interleaved stereo: [L0, R0, L1, R1, ...]
    const leftData = audioBuf.getChannelData(0);
    const rightData = audioBuf.getChannelData(1);
    for (let i = 0; i < frameCount; i++) {
      leftData[i] = int16Array[i * 2] / 32768.0;
      rightData[i] = int16Array[i * 2 + 1] / 32768.0;
    }
  } else {
    // Mono
    const monoData = audioBuf.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      monoData[i] = int16Array[i] / 32768.0;
    }
  }

  const now = ctx.currentTime;

  // Ultra-Smooth Jitter Buffer (Mathematically Gapless Playback)
  if (state.pcAudio.isFirstChunk) {
    state.pcAudio.nextPlayTime = now + state.pcAudio.jitterCushionSec; // 200ms initial cushion on startup
    state.pcAudio.isFirstChunk = false;
  } else if (now > state.pcAudio.nextPlayTime + 0.150) {
    // True network stall (>150ms of dead silence) -> gently re-cushion
    state.pcAudio.nextPlayTime = now + state.pcAudio.jitterCushionSec;
  } else if (state.pcAudio.nextPlayTime > now + 0.450) {
    // Soft clock-drift cap: if buffer accumulated >450ms from background tab, gently catch up
    state.pcAudio.nextPlayTime = now + 0.250;
  }

  // Gapless, seamless playback:
  // If packet arrived slightly late (<150ms), play immediately at 'now' without schedule destruction
  const startAt = Math.max(now, state.pcAudio.nextPlayTime);

  const source = ctx.createBufferSource();
  source.buffer = audioBuf;
  source.connect(state.pcAudio.inputNode);

  source.start(startAt);
  state.pcAudio.nextPlayTime = startAt + audioBuf.duration;
}

// ==========================================
// 5. Listener Initialization
// ==========================================

export function initPcAudioListeners() {
  if (elements.btnTogglePcAudio) {
    elements.btnTogglePcAudio.addEventListener("click", togglePcAudioListening);
  }

  if (elements.pcAudioVolume) {
    elements.pcAudioVolume.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      state.pcAudio.volume = val / 100.0;
      if (elements.pcAudioVolumeVal) elements.pcAudioVolumeVal.textContent = `${val}%`;
      if (state.pcAudio.gainNode) state.pcAudio.gainNode.gain.value = state.pcAudio.volume;
    });
  }
}
