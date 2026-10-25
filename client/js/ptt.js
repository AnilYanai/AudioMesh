/**
 * @file ptt.js
 * @description Walkie-Talkie Push-to-Talk module supporting both Hold-to-Talk and Tap-to-Talk interactions,
 *              PCM chunk packaging, and half-duplex transmission.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, logEvent } from './state.js';
import { getAudioContext, unlockAudioContext, enableMicrophone, floatTo16BitPCM } from './audio-core.js';
import { sendWsBinary } from './voice-ws.js';

let pressStartTime = 0;
let isHolding = false;
let isTouchTriggered = false;

// ==========================================
// 1. Recording Controls
// ==========================================

export async function startRecording() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    try { await ctx.resume(); } catch(e) {}
  }
  if (!state.micReady) {
    logEvent("Mic not ready yet, requesting activation...", "warn");
    await enableMicrophone(false);
    return;
  }
  state.isRecordingPtt = true;
  state.pttAudioBuffer = [];
  if (elements.pttBtn) {
    elements.pttBtn.classList.add("active");
    elements.pttBtn.classList.remove("processing");
  }
  if (elements.pttLabel) elements.pttLabel.textContent = "Recording...";
  if (elements.audioStateTag) elements.audioStateTag.textContent = "Listening to your voice...";
  logEvent("Recording started... Speak into your phone mic!", "highlight");
}

export function stopRecording() {
  if (!state.isRecordingPtt) return;
  state.isRecordingPtt = false;
  if (elements.pttBtn) elements.pttBtn.classList.remove("active");

  const durationSec = state.pttAudioBuffer.length / 16000.0;
  logEvent(`Recording stopped. Captured ${durationSec.toFixed(2)}s (${state.pttAudioBuffer.length} samples).`);

  if (state.pttAudioBuffer.length < 3200) {
    if (elements.pttLabel) elements.pttLabel.textContent = "Hold or Tap to Talk";
    if (elements.audioStateTag) elements.audioStateTag.textContent = "Too short (speak longer)";
    logEvent("Speech was under 0.2s, discarded. Please hold longer.", "warn");
    state.pttAudioBuffer = [];
    return;
  }

  if (elements.pttBtn) elements.pttBtn.classList.add("processing");
  if (elements.pttLabel) elements.pttLabel.textContent = "Transforming...";
  if (elements.audioStateTag) elements.audioStateTag.textContent = "Processing Female Voice...";

  const pcmBytes = floatTo16BitPCM(state.pttAudioBuffer);
  logEvent(`Sending ${pcmBytes.byteLength} bytes to RVC server...`, "highlight");
  state.pttAudioBuffer = [];

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    sendWsBinary(pcmBytes);
    logEvent("Audio transmitted. Server is converting...", "highlight");
  } else {
    logEvent("WebSocket not open! Cannot send audio.", "error");
  }
}

// ==========================================
// 2. Gesture Handlers (Hold vs Tap to Talk)
// ==========================================

export function handlePressStart(e) {
  if (e && e.cancelable) e.preventDefault();
  unlockAudioContext();

  if (!state.micReady) {
    enableMicrophone(false);
    return;
  }

  // If already recording in tap-to-talk mode, a second press stops recording
  if (state.isRecordingPtt && !isHolding) {
    stopRecording();
    return;
  }

  pressStartTime = Date.now();
  isHolding = true;
  startRecording();
}

export function handlePressEnd(e) {
  if (e && e.cancelable) e.preventDefault();
  if (!isHolding) return;
  isHolding = false;
  const holdDuration = Date.now() - pressStartTime;

  if (holdDuration >= 400) {
    // True hold-to-talk: user held button down and released
    stopRecording();
  } else {
    // Short tap (< 400ms): lock into recording mode!
    if (elements.pttLabel) elements.pttLabel.textContent = "Tap to Stop";
    if (elements.audioStateTag) elements.audioStateTag.textContent = "Recording (Tap to Stop)...";
    logEvent("Tap-to-talk active: speaking... Tap button again when done.", "highlight");
  }
}

// ==========================================
// 3. Listener Initialization
// ==========================================

export function initPttListeners() {
  const btn = elements.pttBtn;
  if (!btn) return;

  // Touch events for mobile phones
  btn.addEventListener("touchstart", (e) => {
    isTouchTriggered = true;
    handlePressStart(e);
  }, { passive: false });

  btn.addEventListener("touchend", (e) => {
    handlePressEnd(e);
    setTimeout(() => { isTouchTriggered = false; }, 400);
  }, { passive: false });

  btn.addEventListener("touchcancel", (e) => {
    handlePressEnd(e);
    setTimeout(() => { isTouchTriggered = false; }, 400);
  }, { passive: false });

  // Desktop mouse listeners (ignored on touch devices)
  btn.addEventListener("mousedown", (e) => {
    if (isTouchTriggered) return;
    handlePressStart(e);
  });

  window.addEventListener("mouseup", (e) => {
    if (isTouchTriggered) return;
    if (isHolding) handlePressEnd(e);
  });

  // Suppress synthetic click on mobile so it doesn't double-fire
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    if (!isTouchTriggered && !isHolding && !state.isRecordingPtt) {
      handlePressStart(e);
    }
  });

  // Global AudioContext unlocker on first user touch anywhere
  document.addEventListener("touchstart", unlockAudioContext, { passive: true });
  document.addEventListener("mousedown", unlockAudioContext, { passive: true });
}
