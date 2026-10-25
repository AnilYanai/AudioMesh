/**
 * @file live-stream.js
 * @description Real-time continuous live streaming engine that slices audio chunks
 *              at fixed intervals and dispatches them to the AI conversion server.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, logEvent } from './state.js';
import { enableMicrophone, floatTo16BitPCM } from './audio-core.js';
import { sendWsBinary } from './voice-ws.js';

// ==========================================
// 1. Streaming Operations
// ==========================================

export async function toggleLiveStream() {
  if (state.isLiveStreaming) {
    state.isLiveStreaming = false;
    clearInterval(state.liveIntervalTimer);
    state.liveIntervalTimer = null;

    if (elements.liveToggleBtn) {
      elements.liveToggleBtn.classList.remove("streaming");
      elements.liveToggleBtn.classList.add("start");
    }
    if (elements.liveBtnText) elements.liveBtnText.textContent = "Start Live Conversion";
    if (elements.audioStateTag) elements.audioStateTag.textContent = "Microphone Ready";
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
    if (elements.audioStateTag) elements.audioStateTag.textContent = "Live Streaming...";
    logEvent(`Live stream started! Sending chunks every ${state.liveChunkInterval}s...`, "highlight");

    state.liveIntervalTimer = setInterval(() => {
      if (state.liveAudioBuffer.length > 0 && state.ws && state.ws.readyState === WebSocket.OPEN) {
        const pcmBytes = floatTo16BitPCM(state.liveAudioBuffer);
        logEvent(`Live chunk sending (${(state.liveAudioBuffer.length / 16000).toFixed(2)}s)...`);
        sendWsBinary(pcmBytes);
        state.liveAudioBuffer = [];
      }
    }, state.liveChunkInterval * 1000);
  }
}

export function setChunkInterval(intervalSec) {
  state.liveChunkInterval = parseFloat(intervalSec);
  logEvent(`Chunk interval set to ${state.liveChunkInterval}s`);
  if (state.isLiveStreaming) {
    // Restart interval timer
    toggleLiveStream();
    toggleLiveStream();
  }
}

// ==========================================
// 2. Listener Initialization
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
