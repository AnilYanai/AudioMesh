/**
 * @file live-stream.js
 * @description Real-time continuous live streaming engine that slices audio chunks
 *              driven directly by hardware audio sample count (immune to screen-lock timer freeze).
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, logEvent } from './state.js';
import { enableMicrophone, floatTo16BitPCM } from './audio-core.js';
import { sendWsBinary } from './voice-ws.js';
import { startBackgroundKeepAlive, stopBackgroundKeepAlive } from './background-keepalive.js';

// ==========================================
// 1. Hardware Sample-Driven Chunk Dispatcher
// ==========================================

/**
 * Dispatches accumulated live audio buffer to the server.
 * Driven directly by the audio processing thread (not setInterval),
 * ensuring continuous 100% accurate timing even on locked screen.
 */
export function dispatchLiveAudioChunk() {
  if (!state.isLiveStreaming || state.liveAudioBuffer.length === 0) return;

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    const pcmBytes = floatTo16BitPCM(state.liveAudioBuffer);
    sendWsBinary(pcmBytes);
    state.liveAudioBuffer = [];
  }
}

// ==========================================
// 2. Streaming Operations
// ==========================================

export async function toggleLiveStream() {
  if (state.isLiveStreaming) {
    state.isLiveStreaming = false;

    if (elements.liveToggleBtn) {
      elements.liveToggleBtn.classList.remove("streaming");
      elements.liveToggleBtn.classList.add("start");
    }
    if (elements.liveBtnText) elements.liveBtnText.textContent = "Start Live Conversion";
    if (elements.audioStateTag) elements.audioStateTag.textContent = "Microphone Ready";

    if (!state.pcAudio.isListening) {
      stopBackgroundKeepAlive();
    }
    logEvent("Live stream stopped.");
  } else {
    const ok = await enableMicrophone(false);
    if (!ok) return;

    state.isLiveStreaming = true;
    state.liveAudioBuffer = [];

    if (elements.liveToggleBtn) {
      elements.liveToggleBtn.classList.add("streaming");
      elements.liveToggleBtn.classList.remove("start");
    }
    if (elements.liveBtnText) elements.liveBtnText.textContent = "Stop Live Conversion";
    if (elements.audioStateTag) elements.audioStateTag.textContent = "Live Streaming (Lock Shield Active 🔒)";
    logEvent(`Live stream started! Audio clock locked at full frequency (chunks every ${state.liveChunkInterval}s)...`, "highlight");

    // Engage Lock-Screen Voice Shield (Android MediaSession & high-perf AudioTrack)
    startBackgroundKeepAlive();
  }
}

export function setChunkInterval(intervalSec) {
  state.liveChunkInterval = parseFloat(intervalSec);
  logEvent(`Chunk interval set to ${state.liveChunkInterval}s`);
}

// ==========================================
// 3. Listener Initialization
// ==========================================

export function initLiveStreamListeners() {
  if (elements.liveToggleBtn) {
    elements.liveToggleBtn.addEventListener("click", toggleLiveStream);
  }

  if (elements.chunkIntervalSelect) {
    elements.chunkIntervalSelect.addEventListener("change", (e) => {
      setChunkInterval(e.target.value);
    });
  }
}
