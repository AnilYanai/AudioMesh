/**
 * @file voice-ws.js
 * @description Primary WebSocket connection manager, heartbeat monitor, server message dispatcher,
 *              and converted voice playback router with decoupled feedback-free destination routing.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, logEvent } from './state.js';
import { getAudioContext } from './audio-core.js';
import { syncRoutingFromState, handleTargetPcStatus } from './target-pc.js';
import { setVocalProfile, updatePitchLabel, updateVoiceGainLabel, updateDenoiseBadge } from './ui-controls.js';

let heartbeatTimer = null;

// ==========================================
// 1. Connection Lifecycle
// ==========================================

/**
 * Connects or reconnects the main voice conversion WebSocket (/ws).
 */
export function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  logEvent(`Connecting WebSocket to ${wsUrl}...`);
  if (elements.statusText) elements.statusText.textContent = "Connecting...";
  if (elements.connectionStatus) elements.connectionStatus.className = "status-badge disconnected";

  state.ws = new WebSocket(wsUrl);
  state.ws.binaryType = "arraybuffer";

  state.ws.onopen = () => {
    logEvent("WebSocket connected!", "success");
    if (elements.statusText) elements.statusText.textContent = "Online";
    if (elements.connectionStatus) elements.connectionStatus.className = "status-badge connected";
    startHeartbeat();
  };

  state.ws.onmessage = async (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error("JSON parse error", e);
      }
    } else if (event.data instanceof ArrayBuffer) {
      logEvent(`Received converted audio bytes: ${event.data.byteLength} bytes`, "success");
      handleAudioOutput(event.data);
    }
  };

  state.ws.onclose = () => {
    logEvent("WebSocket disconnected. Retrying in 2s...", "warn");
    if (elements.statusText) elements.statusText.textContent = "Disconnected";
    if (elements.connectionStatus) elements.connectionStatus.className = "status-badge disconnected";
    stopHeartbeat();
    setTimeout(connectWebSocket, 2000);
  };

  state.ws.onerror = (err) => {
    logEvent("WebSocket error occurred", "error");
    if (state.ws) state.ws.close();
  };
}

/**
 * Transmits a JSON payload to the server over the active WebSocket.
 * @param {object} payload
 */
export function sendWsJson(payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  }
}

/**
 * Transmits raw binary PCM audio bytes to the server over the active WebSocket.
 * @param {ArrayBuffer} buffer
 */
export function sendWsBinary(buffer) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(buffer);
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ action: "ping", time: performance.now() }));
    }
  }, 3000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ==========================================
// 2. Incoming Server Message Dispatcher
// ==========================================

export function handleServerMessage(msg) {
  if (msg.type === "connected") {
    logEvent(`Loaded models from server: ${JSON.stringify(msg.available_models)}`, "highlight");
    if (elements.modelSelect) {
      elements.modelSelect.innerHTML = "";
      (msg.available_models || []).forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m.replace(/_/g, " ");
        if (m === msg.current_model) opt.selected = true;
        elements.modelSelect.appendChild(opt);
      });
    }
    if (msg.pitch_lvl !== undefined && elements.pitchSlider) {
      elements.pitchSlider.value = msg.pitch_lvl;
      updatePitchLabel(msg.pitch_lvl);
    }
    if (msg.volume_gain !== undefined && elements.voiceGainSlider) {
      const pct = Math.round(msg.volume_gain * 100);
      elements.voiceGainSlider.value = pct;
      updateVoiceGainLabel(pct);
    }
    if (msg.denoise_mode && elements.denoiseSelect) {
      elements.denoiseSelect.value = msg.denoise_mode;
      updateDenoiseBadge(msg.denoise_mode);
    }
    if (msg.vocal_profile) {
      setVocalProfile(msg.vocal_profile, false);
    }
    if (msg.calibrated_noise_db !== undefined && msg.calibrated_noise_db !== null) {
      const isFan = msg.calibrated_env === "fan_on";
      if (elements.calStatusBadge) {
        elements.calStatusBadge.className = `cal-badge ${isFan ? "fan" : "quiet"}`;
        elements.calStatusBadge.textContent = `${isFan ? "Fan ON" : "Quiet"} (${Math.round(msg.calibrated_noise_db)} dB)`;
      }
    }
    if (msg.routing) {
      syncRoutingFromState(msg.routing);
    }
  } else if (msg.type === "room_calibrated") {
    if (elements.calStatusBadge) {
      const isFan = msg.calibrated_env === "fan_on";
      elements.calStatusBadge.className = `cal-badge ${isFan ? "fan" : "quiet"}`;
      elements.calStatusBadge.textContent = `${isFan ? "Fan ON" : "Quiet"} (${Math.round(msg.calibrated_noise_db)} dB)`;
    }
    logEvent(msg.msg, "success");
  } else if (msg.type === "vocal_profile_updated") {
    if (msg.vocal_profile) {
      setVocalProfile(msg.vocal_profile, false);
    }
  } else if (msg.type === "config_updated") {
    if (msg.volume_gain !== undefined && elements.voiceGainSlider) {
      const pct = Math.round(msg.volume_gain * 100);
      elements.voiceGainSlider.value = pct;
      updateVoiceGainLabel(pct);
    }
    if (msg.denoise_mode && elements.denoiseSelect) {
      elements.denoiseSelect.value = msg.denoise_mode;
      updateDenoiseBadge(msg.denoise_mode);
    }
    if (msg.pitch_lvl !== undefined && elements.pitchSlider) {
      elements.pitchSlider.value = msg.pitch_lvl;
      updatePitchLabel(msg.pitch_lvl);
    }
  } else if (msg.type === "target_pc_status") {
    handleTargetPcStatus(msg);
  } else if (msg.type === "routing_updated") {
    syncRoutingFromState(msg.routing);
  } else if (msg.type === "pong") {
    const rtt = Math.round(performance.now() - msg.time);
    if (elements.statLatency) elements.statLatency.textContent = `${rtt} ms`;
  } else if (msg.type === "progress") {
    logEvent(`⚡ Server: ${msg.msg}`, "highlight");
    if (elements.audioStateTag) elements.audioStateTag.textContent = msg.msg;
  } else if (msg.type === "audio_chunk") {
    state.lastMeta = msg;
    logEvent(`AI conversion completed in ${msg.proc_time_sec}s!`, "success");
    if (msg.proc_time_sec !== undefined && elements.statCompute) {
      elements.statCompute.textContent = `${msg.proc_time_sec}s`;
    }
    if (msg.sample_rate && elements.statSr) {
      elements.statSr.textContent = `${msg.sample_rate.toLocaleString()} Hz`;
    }
    if (msg.target_pc_enabled) {
      logEvent(`📡 Stream delivered to Target PC Virtual Mic!`, "highlight");
    }
    if (msg.mobile_speaker_enabled === false) {
      if (elements.pttBtn) elements.pttBtn.classList.remove("processing");
      if (elements.pttLabel) elements.pttLabel.textContent = "Hold or Tap to Talk";
      if (elements.audioStateTag) elements.audioStateTag.textContent = "Sent to Target PC Mic ✓";
    }
  }
}

// ==========================================
// 3. Converted Audio Output Router (Feedback Loop Protection)
// ==========================================

/**
 * Handles incoming converted audio bytes from the server.
 * Implements decoupled mode specialization:
 * - In Live Streaming Mode: streams strictly to Target PC Virtual Mic (Zero Phone Earphone Loop).
 * - In Walkie-Talkie Mode: plays back into earphones for timbre monitoring.
 *
 * @param {ArrayBuffer} arrayBuffer
 */
export function handleAudioOutput(arrayBuffer) {
  // In Live Streaming mode: audio is streamed strictly to Target PC Virtual Mic (Discord/Calls).
  // The phone does NOT play the converted voice back into the user's ears, completely eliminating any feedback loop!
  if (state.currentMode === "live" || state.isLiveStreaming) {
    if (elements.audioStateTag) {
      elements.audioStateTag.textContent = "Live Stream ➔ PC Mic (Discord Active ✓)";
    }
    return;
  }

  // Walkie-Talkie (PTT) Mode: play converted voice through phone speaker/headphones for voice monitoring!
  if (!state.routingConfig.mobile_speaker_enabled) {
    if (elements.pttBtn) elements.pttBtn.classList.remove("processing");
    if (elements.pttLabel) elements.pttLabel.textContent = "Hold or Tap to Talk";
    if (elements.audioStateTag) elements.audioStateTag.textContent = "Sent to Target PC Mic ✓";
    return;
  }

  const ctx = getAudioContext();
  if (!ctx) return;

  const sr = (state.lastMeta && state.lastMeta.sample_rate) || 40000;
  const int16Array = new Int16Array(arrayBuffer);
  const floatArray = new Float32Array(int16Array.length);

  for (let i = 0; i < int16Array.length; i++) {
    floatArray[i] = int16Array[i] / 32768.0;
  }

  const audioBuf = ctx.createBuffer(1, floatArray.length, sr);
  audioBuf.copyToChannel(floatArray, 0);

  // Cancel any previously playing utterance so voices never overlap or echo!
  if (state.currentVoiceSource) {
    try { state.currentVoiceSource.stop(); } catch(e) {}
    state.currentVoiceSource = null;
  }

  const source = ctx.createBufferSource();
  source.buffer = audioBuf;
  if (state.analyser) source.connect(state.analyser);
  source.connect(ctx.destination);

  state.currentVoiceSource = source;
  const startTime = ctx.currentTime;
  source.start(startTime);

  if (elements.pttBtn) elements.pttBtn.classList.remove("processing");
  if (elements.pttLabel) elements.pttLabel.textContent = "Hold or Tap to Talk";
  if (elements.audioStateTag) elements.audioStateTag.textContent = "Playing Target Voice";
  logEvent(`Playing ${audioBuf.duration.toFixed(2)}s converted female voice!`, "highlight");

  source.onended = () => {
    if (state.currentVoiceSource === source) {
      state.currentVoiceSource = null;
    }
    if (!state.isRecordingPtt && !state.isLiveStreaming && elements.audioStateTag) {
      elements.audioStateTag.textContent = "Microphone Ready";
    }
  };
}
