/**
 * @file ui-controls.js
 * @description UI event listeners, slider bindings, tab navigation, vocal profile toggles,
 *              and engine parameter synchronization with the backend server.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, logEvent } from './state.js';
import { setGlobalAudioMode } from './audio-core.js';
import { sendWsJson } from './voice-ws.js';
import { toggleLiveStream } from './live-stream.js';
import { relinkPcAudioGraph } from './pc-audio.js';

// ==========================================
// 1. Engine & Vocal Profile State
// ==========================================

export function setEngineMode(mode) {
  state.currentEngineMode = mode;
  if (mode === "dsp") {
    if (elements.engineDspBtn) elements.engineDspBtn.classList.add("active");
    if (elements.engineRvcBtn) elements.engineRvcBtn.classList.remove("active");
    logEvent("⚡ Switched to Instant Fast Mode (0.2s)", "success");
  } else {
    if (elements.engineRvcBtn) elements.engineRvcBtn.classList.add("active");
    if (elements.engineDspBtn) elements.engineDspBtn.classList.remove("active");
    logEvent("🧠 Switched to RVC AI Model (Neural Voice)", "highlight");
  }
  sendWsJson({ action: "set_engine_mode", mode: mode });
}

export function setVocalProfile(profile, sendWs = true) {
  state.vocalProfile = (profile === "creator") ? "creator" : "standard";
  if (state.vocalProfile === "creator") {
    if (elements.profileCreatorBtn) elements.profileCreatorBtn.classList.add("active");
    if (elements.profileStandardBtn) elements.profileStandardBtn.classList.remove("active");
    if (elements.profileStatusBadge) {
      elements.profileStatusBadge.textContent = "Creator Mode";
      elements.profileStatusBadge.className = "profile-badge creator";
    }
    logEvent("✨ Creator Profile Active: Soft Voice Boost + De-Hiss + De-Breath", "highlight");
  } else {
    if (elements.profileStandardBtn) elements.profileStandardBtn.classList.add("active");
    if (elements.profileCreatorBtn) elements.profileCreatorBtn.classList.remove("active");
    if (elements.profileStatusBadge) {
      elements.profileStatusBadge.textContent = "Standard";
      elements.profileStatusBadge.className = "profile-badge standard";
    }
    logEvent("🌐 Switched to Standard Voice Profile (Universal)", "success");
  }
  if (sendWs) {
    sendWsJson({ action: "set_vocal_profile", profile: state.vocalProfile });
  }
}

// ==========================================
// 2. Control Label Formatters
// ==========================================

export function updatePitchLabel(val) {
  const num = parseInt(val);
  if (!elements.pitchValue) return;
  if (num === 0) elements.pitchValue.textContent = "0 (Studio Natural)";
  else if (num === -12) elements.pitchValue.textContent = "-12 (Deep Male)";
  else if (num === 12) elements.pitchValue.textContent = "+12 (Bright Female)";
  else elements.pitchValue.textContent = (num > 0 ? `+${num}` : `${num}`);
}

export function updateVoiceGainLabel(val) {
  const num = parseInt(val);
  if (!elements.voiceGainValue) return;
  if (num === 100) elements.voiceGainValue.textContent = "100% (Normal)";
  else if (num >= 150) elements.voiceGainValue.textContent = `+${num}% (Loud)`;
  else elements.voiceGainValue.textContent = `${num}%`;
}

export function updateDenoiseBadge(mode) {
  if (!elements.denoiseBadge) return;
  if (mode === "high") elements.denoiseBadge.textContent = "Strong Denoise";
  else if (mode === "normal" || mode === "clean") elements.denoiseBadge.textContent = "Clean Voice (Best Quality)";
  else if (mode === "low" || mode === "gentle") elements.denoiseBadge.textContent = "Gentle Filter";
  else if (mode === "off") elements.denoiseBadge.textContent = "Raw Mic (100% Studio Quality)";
}

export function updateNoiseGate(val) {
  const num = parseInt(val);
  if (num === 0) {
    state.gateMode = "off";
    state.noiseGateThreshold = 0;
    if (elements.noiseGateVal) elements.noiseGateVal.textContent = "Off (0%)";
  } else if (num >= 35 && num <= 65) {
    state.gateMode = "auto";
    if (elements.noiseGateVal) elements.noiseGateVal.textContent = "Auto-Smart (Fan Adaptive)";
  } else {
    state.gateMode = "manual";
    // Map slider 1-100 to gentle RMS threshold 0.003 to 0.025
    state.noiseGateThreshold = 0.003 + (num / 100.0) * 0.022;
    if (elements.noiseGateVal) {
      if (num > 65) elements.noiseGateVal.textContent = `Strict (${num}%)`;
      else elements.noiseGateVal.textContent = `Gentle (${num}%)`;
    }
  }
}

// ==========================================
// 3. Listener Initialization
// ==========================================

export function initUiListeners() {
  // Global Audio Profile Toggles
  if (elements.btnGlobalCallMode) {
    elements.btnGlobalCallMode.addEventListener("click", () => setGlobalAudioMode("call", relinkPcAudioGraph));
  }
  if (elements.btnGlobalMusicMode) {
    elements.btnGlobalMusicMode.addEventListener("click", () => setGlobalAudioMode("music", relinkPcAudioGraph));
  }

  // Engine Mode Toggles
  if (elements.engineDspBtn) {
    elements.engineDspBtn.addEventListener("click", () => setEngineMode("dsp"));
  }
  if (elements.engineRvcBtn) {
    elements.engineRvcBtn.addEventListener("click", () => setEngineMode("rvc"));
  }

  // Vocal Profile Toggles
  if (elements.profileStandardBtn) {
    elements.profileStandardBtn.addEventListener("click", () => setVocalProfile("standard"));
  }
  if (elements.profileCreatorBtn) {
    elements.profileCreatorBtn.addEventListener("click", () => setVocalProfile("creator"));
  }

  // Navigation Tab Switching
  if (elements.modePttBtn) {
    elements.modePttBtn.addEventListener("click", () => {
      state.currentMode = "ptt";
      elements.modePttBtn.classList.add("active");
      if (elements.modeLiveBtn) elements.modeLiveBtn.classList.remove("active");
      if (elements.modeTargetBtn) elements.modeTargetBtn.classList.remove("active");
      if (elements.pttSection) elements.pttSection.classList.remove("hidden");
      if (elements.liveSection) elements.liveSection.classList.add("hidden");
      if (elements.targetSection) elements.targetSection.classList.add("hidden");
      if (state.isLiveStreaming) toggleLiveStream();
      logEvent("Switched to Walkie-Talkie (PTT) mode");
    });
  }

  if (elements.modeLiveBtn) {
    elements.modeLiveBtn.addEventListener("click", () => {
      state.currentMode = "live";
      elements.modeLiveBtn.classList.add("active");
      if (elements.modePttBtn) elements.modePttBtn.classList.remove("active");
      if (elements.modeTargetBtn) elements.modeTargetBtn.classList.remove("active");
      if (elements.liveSection) elements.liveSection.classList.remove("hidden");
      if (elements.pttSection) elements.pttSection.classList.add("hidden");
      if (elements.targetSection) elements.targetSection.classList.add("hidden");
      logEvent("Switched to Live Streaming mode");
    });
  }

  if (elements.modeTargetBtn) {
    elements.modeTargetBtn.addEventListener("click", () => {
      state.currentMode = "target";
      elements.modeTargetBtn.classList.add("active");
      if (elements.modePttBtn) elements.modePttBtn.classList.remove("active");
      if (elements.modeLiveBtn) elements.modeLiveBtn.classList.remove("active");
      if (elements.targetSection) elements.targetSection.classList.remove("hidden");
      if (elements.pttSection) elements.pttSection.classList.add("hidden");
      if (elements.liveSection) elements.liveSection.classList.add("hidden");
      if (state.isLiveStreaming) toggleLiveStream();
      logEvent("Switched to PC Virtual Mic Setup");
    });
  }

  if (elements.routingStatusPill) {
    elements.routingStatusPill.style.cursor = "pointer";
    elements.routingStatusPill.addEventListener("click", () => {
      if (elements.modeTargetBtn) elements.modeTargetBtn.click();
    });
  }

  // Pitch Shift Slider
  if (elements.pitchSlider) {
    elements.pitchSlider.addEventListener("input", (e) => {
      updatePitchLabel(e.target.value);
    });
    elements.pitchSlider.addEventListener("change", (e) => {
      const val = parseInt(e.target.value);
      logEvent(`Pitch shift changed to ${val}`);
      sendWsJson({ action: "set_config", pitch: val });
    });
  }

  // Quick Voice Transform Presets (Deep Male, Natural Studio, Bright Female)
  const btnPresetMale = document.getElementById("btnPresetMale");
  const btnPresetNatural = document.getElementById("btnPresetNatural");
  const btnPresetFemale = document.getElementById("btnPresetFemale");

  if (btnPresetMale) {
    btnPresetMale.addEventListener("click", () => {
      if (elements.pitchSlider) {
        elements.pitchSlider.value = -12;
        updatePitchLabel(-12);
        sendWsJson({ action: "set_config", pitch: -12 });
        logEvent("Set Voice Preset: 🧔 Deep Male (-12 semitones)", "highlight");
      }
    });
  }
  if (btnPresetNatural) {
    btnPresetNatural.addEventListener("click", () => {
      if (elements.pitchSlider) {
        elements.pitchSlider.value = 0;
        updatePitchLabel(0);
        sendWsJson({ action: "set_config", pitch: 0 });
        logEvent("Set Voice Preset: 🎙️ Studio Natural (0 semitones)", "highlight");
      }
    });
  }
  if (btnPresetFemale) {
    btnPresetFemale.addEventListener("click", () => {
      if (elements.pitchSlider) {
        elements.pitchSlider.value = 12;
        updatePitchLabel(12);
        sendWsJson({ action: "set_config", pitch: 12 });
        logEvent("Set Voice Preset: 👧 Bright Female (+12 semitones)", "highlight");
      }
    });
  }

  // Voice Gain Slider
  if (elements.voiceGainSlider) {
    elements.voiceGainSlider.addEventListener("input", (e) => {
      updateVoiceGainLabel(e.target.value);
    });
    elements.voiceGainSlider.addEventListener("change", (e) => {
      const val = parseInt(e.target.value);
      const gainFactor = (val / 100.0).toFixed(2);
      logEvent(`Voice volume boost changed to ${val}% (${gainFactor}x)`);
      sendWsJson({ action: "set_config", volume: parseFloat(gainFactor) });
    });
  }

  // Model & Algo Selectors
  if (elements.modelSelect) {
    elements.modelSelect.addEventListener("change", (e) => {
      const model = e.target.value;
      logEvent(`Selected model: ${model}`);
      sendWsJson({ action: "set_config", model: model });
    });
  }

  if (elements.algoSelect) {
    elements.algoSelect.addEventListener("change", (e) => {
      const algo = e.target.value;
      logEvent(`Selected algorithm: ${algo}`);
      sendWsJson({ action: "set_config", algo: algo });
    });
  }

  // Denoise Mode Selector
  if (elements.denoiseSelect) {
    elements.denoiseSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      updateDenoiseBadge(val);
      logEvent(`Noise filter set to: ${val}`);
      sendWsJson({ action: "set_config", denoise: val });
    });
  }

  // Client Noise Gate Slider
  if (elements.noiseGateSlider) {
    elements.noiseGateSlider.addEventListener("input", (e) => {
      updateNoiseGate(e.target.value);
    });
  }

  // Clear Activity Log
  if (elements.clearLogBtn) {
    elements.clearLogBtn.addEventListener("click", () => {
      if (elements.activityLog) elements.activityLog.innerHTML = "";
    });
  }
}
