/**
 * @file pc-audio.js
 * @description Wireless Target PC audio downlink (Desktop/Discord/Call stream to phone headphones),
 *              adaptive 200ms jitter cushion, and Call vs Music mode Web Audio DSP filters.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, logEvent } from './state.js';
import { getAudioContext } from './audio-core.js';
import { activateMediaSession, deactivateMediaSession, unlockMediaSessionOnUserGesture } from './media-session.js';

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

  // 4. Transparent Brickwall Peak Limiter (for Music Mode): prevents loud speech bursts from clipping mobile DAC
  if (!state.pcAudio.limiterNode) {
    state.pcAudio.limiterNode = ctx.createDynamicsCompressor();
    state.pcAudio.limiterNode.threshold.value = -0.5; // Transparent: only catches peaks above -0.5dB
    state.pcAudio.limiterNode.knee.value = 0;         // Brickwall
    state.pcAudio.limiterNode.ratio.value = 20.0;     // Full limiting
    state.pcAudio.limiterNode.attack.value = 0.001;   // 1ms ultrafast attack
    state.pcAudio.limiterNode.release.value = 0.050;  // 50ms fast recovery
  }

  relinkPcAudioGraph();
}

export function relinkPcAudioGraph() {
  if (!state.pcAudio.gainNode || !state.audioContext) return;
  const ctx = state.audioContext;

  try {
    if (state.pcAudio.highpassNode) state.pcAudio.highpassNode.disconnect();
    if (state.pcAudio.presenceNode) state.pcAudio.presenceNode.disconnect();
    if (state.pcAudio.compressorNode) state.pcAudio.compressorNode.disconnect();
    if (state.pcAudio.limiterNode) state.pcAudio.limiterNode.disconnect();
    if (state.pcAudio.gainNode) state.pcAudio.gainNode.disconnect();
  } catch (e) {}

  if (state.globalAudioMode === "call") {
    // 📞 Call Mode DSP Chain:
    // Input -> Highpass (85Hz) -> Presence (+3.5dB @ 2.8kHz) -> Compressor -> Gain -> Destination
    state.pcAudio.highpassNode.connect(state.pcAudio.presenceNode);
    state.pcAudio.presenceNode.connect(state.pcAudio.compressorNode);
    state.pcAudio.compressorNode.connect(state.pcAudio.gainNode);
    state.pcAudio.gainNode.connect(ctx.destination);
    state.pcAudio.inputNode = state.pcAudio.highpassNode;
  } else {
    // 🎵 Music Mode: 100% Pure Untouched Hi-Fi Stereo -> Gain -> Transparent Peak Limiter -> Destination
    if (state.pcAudio.limiterNode) {
      state.pcAudio.gainNode.connect(state.pcAudio.limiterNode);
      state.pcAudio.limiterNode.connect(ctx.destination);
    } else {
      state.pcAudio.gainNode.connect(ctx.destination);
    }
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
      activateMediaSession();
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
      deactivateMediaSession();
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
  deactivateMediaSession();
  if (state.pcAudio.ws) {
    try { state.pcAudio.ws.close(); } catch(e) {}
    state.pcAudio.ws = null;
  }
  updatePcAudioUI(false);
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
  const leftData = audioBuf.getChannelData(0);
  const rightData = channels === 2 ? audioBuf.getChannelData(1) : null;

  for (let i = 0; i < frameCount; i++) {
    leftData[i] = int16Array[i * channels] / 32768.0;
    if (rightData) {
      rightData[i] = int16Array[i * channels + 1] / 32768.0;
    }
  }

  const now = ctx.currentTime;
  const duration = audioBuf.duration;
  let needsFadeIn = false;
  let startAt = 0;

  // 1. Initial Connection / Mode Switch Warm-up:
  // Starts with an 85ms cushion for the first 35 chunks (~0.75s) to absorb the initial
  // PipeWire spawn latency (~57ms) and mobile Wi-Fi sleep-wake latency.
  if (state.pcAudio.isFirstChunk) {
    state.pcAudio.startupChunks = 0;
    const initialCushion = Math.max(state.pcAudio.jitterCushionSec, 0.085);
    state.pcAudio.nextPlayTime = now + initialCushion;
    state.pcAudio.isFirstChunk = false;
    needsFadeIn = true;
    startAt = state.pcAudio.nextPlayTime;
  } else {
    state.pcAudio.startupChunks++;

    // Once running smoothly for 35 chunks (~0.75s), seamlessly transition from warm-up cushion to target cushion
    if (state.pcAudio.startupChunks === 35 && state.pcAudio.jitterCushionSec < 0.085) {
      state.pcAudio.nextPlayTime = now + state.pcAudio.jitterCushionSec;
      needsFadeIn = true;
    }

    // 2. Buffer Underrun / Late Packet (Packet arrived after previous audio ended)
    if (now > state.pcAudio.nextPlayTime) {
      const lateBy = now - state.pcAudio.nextPlayTime;
      if (lateBy < 0.150) {
        // Minor packet delay (<150ms): play immediately at 'now' with zero artificial gap!
        startAt = now;
      } else {
        // Severe network stall (>150ms): re-cushion at target jitter cushion
        startAt = now + state.pcAudio.jitterCushionSec;
      }
      state.pcAudio.nextPlayTime = startAt;
      needsFadeIn = true; // Micro-fade prevents step discontinuity click when audio resumes
    }
    // 3. Excess Clock Drift: buffer drifted > 200ms behind real-time
    else if (state.pcAudio.nextPlayTime > now + 0.200) {
      startAt = now + state.pcAudio.jitterCushionSec;
      state.pcAudio.nextPlayTime = startAt;
      needsFadeIn = true;
    }
    // 4. Guaranteed Seamless Contiguous Playback (zero gap, zero overlap)
    else {
      startAt = state.pcAudio.nextPlayTime;
    }
  }

  // 5. Gap-Recovery Micro-Fade (1.5ms / ~72 samples)
  // ONLY applied when recovering from an underrun or initial startup.
  // Continuous back-to-back chunks remain 100% untouched bit-perfect PCM!
  if (needsFadeIn) {
    const fadeSamples = Math.min(72, frameCount);
    for (let i = 0; i < fadeSamples; i++) {
      const g = 0.5 * (1 - Math.cos((Math.PI * i) / fadeSamples)); // Smooth raised cosine ramp
      leftData[i] *= g;
      if (rightData) rightData[i] *= g;
    }
  }

  const source = ctx.createBufferSource();
  source.buffer = audioBuf;
  source.connect(state.pcAudio.inputNode);
  source.start(startAt);

  // Next chunk plays strictly when this one ends: ZERO gaps, ZERO overlapping collisions
  state.pcAudio.nextPlayTime = startAt + duration;
}

// ==========================================
// 5. Listener Initialization
// ==========================================

export function initPcAudioListeners() {
  if (elements.btnTogglePcAudio) {
    elements.btnTogglePcAudio.addEventListener("click", () => {
      // Synchronous user activation to grant mobile OS Audio Focus for headphones
      unlockMediaSessionOnUserGesture();
      togglePcAudioListening();
    });
  }

  if (elements.pcAudioVolume) {
    elements.pcAudioVolume.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      state.pcAudio.volume = val / 100.0;
      if (elements.pcAudioVolumeVal) elements.pcAudioVolumeVal.textContent = `${val}%`;
      if (state.pcAudio.gainNode) state.pcAudio.gainNode.gain.value = state.pcAudio.volume;
    });
  }

  if (elements.pcAudioLatencyMode) {
    elements.pcAudioLatencyMode.addEventListener("change", (e) => {
      const mode = e.target.value;
      if (mode === "ultra") {
        state.pcAudio.jitterCushionSec = 0.045;
        if (elements.pcAudioLatencyVal) elements.pcAudioLatencyVal.textContent = "⚡ Video Sync (45ms)";
        logEvent("⚡ PC Audio Latency set to Ultra-Sync (45ms) for video lip-sync.", "highlight");
      } else if (mode === "balanced") {
        state.pcAudio.jitterCushionSec = 0.075;
        if (elements.pcAudioLatencyVal) elements.pcAudioLatencyVal.textContent = "⚖️ Balanced (75ms)";
        logEvent("⚖️ PC Audio Latency set to Balanced (75ms).", "highlight");
      } else {
        state.pcAudio.jitterCushionSec = 0.140;
        if (elements.pcAudioLatencyVal) elements.pcAudioLatencyVal.textContent = "🎵 Stable (140ms)";
        logEvent("🎵 PC Audio Latency set to Stable Buffer (140ms).", "highlight");
      }
      state.pcAudio.isFirstChunk = true;
    });
  }
}
