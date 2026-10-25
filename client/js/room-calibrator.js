/**
 * @file room-calibrator.js
 * @description 1.5-second ambient room noise calibration engine. Samples room acoustics,
 *              calculates median noise floor, and switches between Fan-Suppression and Quiet Room DSP modes.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, logEvent } from './state.js';
import { enableMicrophone } from './audio-core.js';
import { sendWsJson } from './voice-ws.js';

// ==========================================
// 1. Calibration Routine
// ==========================================

export async function startRoomCalibration() {
  if (state.isCalibratingRoom) return;

  if (!state.micReady) {
    const ok = await enableMicrophone(false);
    if (!ok) return;
  }

  state.isCalibratingRoom = true;
  state.calibrationRmsSamples = [];

  if (elements.calibrateRoomBtn) elements.calibrateRoomBtn.disabled = true;
  if (elements.calProgressWrap) elements.calProgressWrap.style.display = "flex";
  if (elements.calStatusBadge) {
    elements.calStatusBadge.className = "cal-badge listening";
    elements.calStatusBadge.textContent = "Listening...";
  }
  if (elements.calBtnText) elements.calBtnText.textContent = "Sampling room noise...";

  const startTime = performance.now();
  const totalDuration = 1500; // 1.5 seconds

  const progressInterval = setInterval(() => {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(100, (elapsed / totalDuration) * 100);
    const remaining = Math.max(0, ((totalDuration - elapsed) / 1000)).toFixed(1);

    if (elements.calProgressBar) elements.calProgressBar.style.width = `${progress}%`;
    if (elements.calCountdownText) elements.calCountdownText.textContent = `Listening to room... stay silent (${remaining}s)`;

    if (elapsed >= totalDuration) {
      clearInterval(progressInterval);
      finishRoomCalibration();
    }
  }, 50);
}

export function finishRoomCalibration() {
  state.isCalibratingRoom = false;

  let avgRms = 0.005;
  if (state.calibrationRmsSamples.length > 0) {
    // Sort and take 50th percentile (median) to ignore any transient accidental tap
    const sorted = [...state.calibrationRmsSamples].sort((a, b) => a - b);
    avgRms = sorted[Math.floor(sorted.length * 0.5)];
  }

  const noiseDb = Math.round(20 * Math.log10(Math.max(avgRms, 1e-4)));
  state.ambientNoiseFloor = avgRms; // Immediately calibrate the client noise tracker

  let detectedMode = "quiet";
  if (noiseDb > -54) {
    detectedMode = "fan_on";
    if (elements.calStatusBadge) {
      elements.calStatusBadge.className = "cal-badge fan";
      elements.calStatusBadge.textContent = `Fan ON (${noiseDb} dB)`;
    }
    logEvent(`🎯 Room Calibrated: ${noiseDb} dBFS -> Fan ON Mode Activated (+4dB Forward Vocal Boost)`, "highlight");
  } else {
    detectedMode = "quiet";
    if (elements.calStatusBadge) {
      elements.calStatusBadge.className = "cal-badge quiet";
      elements.calStatusBadge.textContent = `Quiet (${noiseDb} dB)`;
    }
    logEvent(`🎯 Room Calibrated: ${noiseDb} dBFS -> Quiet Room Mode Activated (Pure Transparent)`, "success");
  }

  sendWsJson({
    action: "calibrate_room",
    noise_db: noiseDb,
    mode: detectedMode
  });

  if (elements.calCountdownText) {
    elements.calCountdownText.textContent = `Calibrated ✓ Noise: ${noiseDb} dB (${detectedMode === "fan_on" ? "Fan ON" : "Quiet Room"})`;
  }

  setTimeout(() => {
    if (elements.calProgressWrap) elements.calProgressWrap.style.display = "none";
    if (elements.calProgressBar) elements.calProgressBar.style.width = "0%";
    if (elements.calibrateRoomBtn) {
      elements.calibrateRoomBtn.disabled = false;
      if (elements.calBtnText) elements.calBtnText.textContent = "Re-Calibrate Room (1.5s)";
    }
  }, 1200);
}

// ==========================================
// 2. Listener Initialization
// ==========================================

export function initRoomCalibratorListeners() {
  if (elements.calibrateRoomBtn) {
    elements.calibrateRoomBtn.addEventListener("click", startRoomCalibration);
  }
}
