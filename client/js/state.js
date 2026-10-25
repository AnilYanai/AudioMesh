/**
 * @file state.js
 * @description Centralized application state, configuration objects, DOM element references,
 *              and logging utilities for VoiceMorph client.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

// ==========================================
// 1. Reactive Application State
// ==========================================

export const state = {
  // Global connection handles
  ws: null,
  audioContext: null,
  mediaStream: null,
  scriptProcessor: null,
  analyser: null,

  // Global Audio Profile: 'call' (Earpiece + Hardware AEC) vs 'music' (Full 48kHz Stereo Media Volume)
  globalAudioMode: "call",

  // Operating Mode: 'ptt' (Walkie-Talkie), 'live' (Streaming to PC Virtual Mic), 'target' (Driver Setup)
  currentMode: "ptt",

  // Voice Engine Mode: 'dsp' (Instant 0.2s vocoder) or 'rvc' (Neural AI HuBERT+VITS)
  currentEngineMode: "dsp",

  // Vocal Profile: 'standard' (Universal) vs 'creator' (Soft Voice Boost + De-Esser + De-Breath)
  vocalProfile: "standard",

  // Microphone and Recording States
  micReady: false,
  isMicMuted: false,
  isRecordingPtt: false,
  isLiveStreaming: false,
  isCalibratingRoom: false,

  // Audio Buffers
  pttAudioBuffer: [],
  liveAudioBuffer: [],
  liveChunkInterval: 1.5,
  liveIntervalTimer: null,
  lastMeta: null,
  currentVoiceSource: null,

  // Acoustic & Noise Gate Tracking
  ambientNoiseFloor: 0.015,     // Running RMS estimate of background room noise
  speechPeakLevel: 0.050,       // Running RMS estimate of user voice
  autoDynamicGateThreshold: 0.020,
  gateMode: "auto",             // 'off', 'auto', 'manual'
  noiseGateThreshold: 0.0,
  gateGain: 1.0,
  gateHangoverFrames: 0,
  lastAcousticUiUpdate: 0,
  calibrationRmsSamples: [],

  // Target PC Virtual Mic Routing
  routingConfig: {
    target_pc_ip: "127.0.0.1",
    target_pc_port: 8001,
    target_pc_enabled: true,
    mobile_speaker_enabled: true
  },

  // Target PC Audio Downlink (Listening to Discord/Calls)
  pcAudio: {
    ws: null,
    isListening: false,
    volume: 1.0,
    sampleRate: 48000,
    channels: 2,
    nextPlayTime: 0,
    isFirstChunk: true,
    jitterCushionSec: 0.050,    // 50ms low-latency cushion for video lip-sync
    gainNode: null,
    highpassNode: null,
    presenceNode: null,
    compressorNode: null,
    inputNode: null
  }
};

// ==========================================
// 2. DOM Element Selectors
// ==========================================

export const elements = {
  // Global Profile Toggles
  btnGlobalCallMode: document.getElementById("btnGlobalCallMode"),
  btnGlobalMusicMode: document.getElementById("btnGlobalMusicMode"),
  globalModeBadge: document.getElementById("globalModeBadge"),

  // Header & Connection
  connectionStatus: document.getElementById("connectionStatus"),
  statusText: document.getElementById("statusText"),
  audioStateTag: document.getElementById("audioStateTag"),

  // Microphone Prompt Banner
  micPromptBanner: document.getElementById("micPromptBanner"),
  micBannerTitle: document.getElementById("micBannerTitle"),
  micBannerSub: document.getElementById("micBannerSub"),
  enableMicBtn: document.getElementById("enableMicBtn"),

  // Mode Navigation Tabs & Sections
  modePttBtn: document.getElementById("modePtt"),
  modeLiveBtn: document.getElementById("modeLive"),
  modeTargetBtn: document.getElementById("modeTarget"),
  pttSection: document.getElementById("pttSection"),
  liveSection: document.getElementById("liveSection"),
  targetSection: document.getElementById("targetSection"),

  // Engine Mode & Vocal Profile
  engineDspBtn: document.getElementById("engineDspBtn"),
  engineRvcBtn: document.getElementById("engineRvcBtn"),
  profileStandardBtn: document.getElementById("profileStandardBtn"),
  profileCreatorBtn: document.getElementById("profileCreatorBtn"),
  profileStatusBadge: document.getElementById("profileStatusBadge"),

  // Walkie-Talkie (PTT)
  pttBtn: document.getElementById("pttButton"),
  pttLabel: document.getElementById("pttLabel"),

  // Live Stream
  liveToggleBtn: document.getElementById("liveToggleBtn"),
  liveBtnText: document.getElementById("liveBtnText"),
  chunkIntervalSelect: document.getElementById("chunkIntervalSelect"),

  // Target PC Routing & Verification
  routingStatusPill: document.getElementById("routingStatusPill"),
  pillTargetStatus: document.getElementById("pillTargetStatus"),
  pillMobileStatus: document.getElementById("pillMobileStatus"),
  targetVerifyBadge: document.getElementById("targetVerifyBadge"),
  targetVerifyText: document.getElementById("targetVerifyText"),
  targetIpInput: document.getElementById("targetIpInput"),
  targetPortInput: document.getElementById("targetPortInput"),
  btnQuickLocalhost: document.getElementById("btnQuickLocalhost"),
  btnVerifyTarget: document.getElementById("btnVerifyTarget"),
  verifySpinner: document.getElementById("verifySpinner"),
  verifyBtnIcon: document.getElementById("verifyBtnIcon"),
  verifyBtnText: document.getElementById("verifyBtnText"),
  detailsDriverStatus: document.getElementById("detailsDriverStatus"),
  detailsPlatform: document.getElementById("detailsPlatform"),
  detailsVirtualMic: document.getElementById("detailsVirtualMic"),
  toggleTargetPc: document.getElementById("toggleTargetPc"),
  toggleMobileSpeaker: document.getElementById("toggleMobileSpeaker"),

  // Target PC Audio Downlink (Listen to PC Sound)
  pillHearPcStatus: document.getElementById("pillHearPcStatus"),
  pcAudioBadge: document.getElementById("pcAudioBadge"),
  pcAudioBadgeText: document.getElementById("pcAudioBadgeText"),
  btnTogglePcAudio: document.getElementById("btnTogglePcAudio"),
  btnPcAudioIcon: document.getElementById("btnPcAudioIcon"),
  btnPcAudioText: document.getElementById("btnPcAudioText"),
  pcAudioVolume: document.getElementById("pcAudioVolume"),
  pcAudioVolumeVal: document.getElementById("pcAudioVolumeVal"),
  pcAudioFmtBadge: document.getElementById("pcAudioFmtBadge"),

  // Voice Settings & Controls
  modelSelect: document.getElementById("modelSelect"),
  pitchSlider: document.getElementById("pitchSlider"),
  pitchValue: document.getElementById("pitchValue"),
  voiceGainSlider: document.getElementById("voiceGainSlider"),
  voiceGainValue: document.getElementById("voiceGainValue"),
  algoSelect: document.getElementById("algoSelect"),
  denoiseSelect: document.getElementById("denoiseSelect"),
  denoiseBadge: document.getElementById("denoiseBadge"),
  noiseGateSlider: document.getElementById("noiseGateSlider"),
  noiseGateVal: document.getElementById("noiseGateVal"),

  // Room Noise Calibration
  calibrateRoomBtn: document.getElementById("calibrateRoomBtn"),
  calStatusBadge: document.getElementById("calStatusBadge"),
  calBtnIcon: document.getElementById("calBtnIcon"),
  calBtnText: document.getElementById("calBtnText"),
  calProgressWrap: document.getElementById("calProgressWrap"),
  calProgressBar: document.getElementById("calProgressBar"),
  calCountdownText: document.getElementById("calCountdownText"),

  // Telemetry & Acoustic Stats
  statNoiseFloor: document.getElementById("statNoiseFloor"),
  statVoiceLevel: document.getElementById("statVoiceLevel"),
  statSnrQuality: document.getElementById("statSnrQuality"),
  statLatency: document.getElementById("statLatency"),
  statCompute: document.getElementById("statCompute"),
  statSr: document.getElementById("statSr"),

  // Visualizer & Activity Log
  canvas: document.getElementById("visualizerCanvas"),
  activityLog: document.getElementById("activityLog"),
  clearLogBtn: document.getElementById("clearLogBtn")
};

// ==========================================
// 3. Central Logging & Remote Telemetry
// ==========================================

/**
 * Appends an event to the on-screen live status log, console, and sends telemetry to the server terminal.
 * @param {string} msg - The log message text.
 * @param {'normal'|'highlight'|'success'|'warn'|'error'} [type='normal'] - Visual styling category.
 */
export function logEvent(msg, type = "normal") {
  const time = new Date().toLocaleTimeString().split(" ")[0];
  const fullMsg = `[${time}] ${msg}`;
  console.log(fullMsg);

  if (elements.activityLog) {
    const line = document.createElement("div");
    line.className = `log-line ${type}`;
    line.textContent = fullMsg;
    elements.activityLog.appendChild(line);
    elements.activityLog.scrollTop = elements.activityLog.scrollHeight;
  }

  // Transmit telemetry to server terminal over active WebSocket
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    try {
      state.ws.send(JSON.stringify({ action: "client_log", msg: msg }));
    } catch (e) {}
  }
}

/**
 * Automatically adjusts visualizer canvas dimensions to match responsive CSS layout.
 */
export function resizeCanvas() {
  if (elements.canvas) {
    const parent = elements.canvas.parentElement;
    elements.canvas.width = (parent && parent.clientWidth > 0) ? parent.clientWidth : window.innerWidth || 320;
    elements.canvas.height = (parent && parent.clientHeight > 0) ? parent.clientHeight : 100;
  }
}
