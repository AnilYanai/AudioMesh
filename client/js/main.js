/**
 * @file main.js
 * @description Main application entry point and orchestrator for VoiceMorph PWA client.
 *              Initializes audio pipeline, WebSockets, gesture controls, and UI bindings.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, logEvent, resizeCanvas } from './state.js';
import { getAudioContext, checkExistingPermission, enableMicrophone, stopMicrophone, setGlobalAudioMode } from './audio-core.js';
import { connectWebSocket, sendWsJson, sendWsBinary } from './voice-ws.js';
import { initPttListeners, startRecording, stopRecording } from './ptt.js';
import { initLiveStreamListeners, toggleLiveStream } from './live-stream.js';
import { initTargetPcListeners, verifyTargetPC } from './target-pc.js';
import { initPcAudioListeners, togglePcAudioListening, relinkPcAudioGraph } from './pc-audio.js';
import { initRoomCalibratorListeners, startRoomCalibration } from './room-calibrator.js';
import { initVisualizer } from './visualizer.js';
import { initUiListeners, setEngineMode, setVocalProfile } from './ui-controls.js';

/**
 * Global developer diagnostics handle available in browser console.
 * Allows inspecting real-time internal state and triggering test routines.
 */
window.VoiceMorph = {
  version: "20261026_autowarm_v22",
  state,
  elements,
  getAudioContext,
  enableMicrophone,
  stopMicrophone,
  setGlobalAudioMode,
  setEngineMode,
  setVocalProfile,
  toggleLiveStream,
  verifyTargetPC,
  togglePcAudioListening,
  startRoomCalibration,
  logEvent
};

/**
 * Bootstrap sequence executed when DOM is ready.
 */
function initApp() {
  logEvent(`VoiceMorph Client v${window.VoiceMorph.version} initializing...`, "highlight");

  // 1. Initialize Visualizer Canvas & Resize Observer
  initVisualizer();

  // 2. Initialize UI Interaction Handlers
  initUiListeners();
  initPttListeners();
  initLiveStreamListeners();
  initTargetPcListeners();
  initPcAudioListeners();
  initRoomCalibratorListeners();

  // 3. Connect to Conversion Server WebSocket
  connectWebSocket();

  // 4. Verify HTTPS Context & Check Microphone Permissions
  checkExistingPermission();

  logEvent("VoiceMorph initialized successfully. Ready for user interaction.", "success");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
