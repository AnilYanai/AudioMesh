// RVC Mobile Voice Changer Client Logic
let ws = null;
let audioContext = null;
let mediaStream = null;
let scriptProcessor = null;
let analyser = null;
let isRecordingPtt = false;
let isLiveStreaming = false;
let pttAudioBuffer = [];
let liveChunkInterval = 1.5;
let liveIntervalTimer = null;
let currentMode = "ptt";
let nextPlayTime = 0;
let micReady = false;

// UI Elements
const btnGlobalCallMode = document.getElementById("btnGlobalCallMode");
const btnGlobalMusicMode = document.getElementById("btnGlobalMusicMode");
const globalModeBadge = document.getElementById("globalModeBadge");
let globalAudioMode = "call"; // Defaults to Call Mode (Hardware AEC & Earpiece for calls/walkie-talkie)

const statusBadge = document.getElementById("connectionStatus");
const statusText = document.getElementById("statusText");
const micPromptBanner = document.getElementById("micPromptBanner");
const micBannerTitle = document.getElementById("micBannerTitle");
const micBannerSub = document.getElementById("micBannerSub");
const enableMicBtn = document.getElementById("enableMicBtn");
const engineDspBtn = document.getElementById("engineDspBtn");
const engineRvcBtn = document.getElementById("engineRvcBtn");
const profileStandardBtn = document.getElementById("profileStandardBtn");
const profileCreatorBtn = document.getElementById("profileCreatorBtn");
const profileStatusBadge = document.getElementById("profileStatusBadge");
let vocalProfile = "standard";
const pttBtn = document.getElementById("pttButton");
const pttLabel = document.getElementById("pttLabel");
const modePttBtn = document.getElementById("modePtt");
const modeLiveBtn = document.getElementById("modeLive");
const modeTargetBtn = document.getElementById("modeTarget");
const pttSection = document.getElementById("pttSection");
const liveSection = document.getElementById("liveSection");
const targetSection = document.getElementById("targetSection");

// Target PC Routing Elements
const routingStatusPill = document.getElementById("routingStatusPill");
const pillTargetStatus = document.getElementById("pillTargetStatus");
const pillMobileStatus = document.getElementById("pillMobileStatus");
const targetVerifyBadge = document.getElementById("targetVerifyBadge");
const targetVerifyText = document.getElementById("targetVerifyText");
const targetIpInput = document.getElementById("targetIpInput");
const targetPortInput = document.getElementById("targetPortInput");
const btnQuickLocalhost = document.getElementById("btnQuickLocalhost");
const btnVerifyTarget = document.getElementById("btnVerifyTarget");
const verifySpinner = document.getElementById("verifySpinner");
const verifyBtnIcon = document.getElementById("verifyBtnIcon");
const verifyBtnText = document.getElementById("verifyBtnText");
const detailsDriverStatus = document.getElementById("detailsDriverStatus");
const detailsPlatform = document.getElementById("detailsPlatform");
const detailsVirtualMic = document.getElementById("detailsVirtualMic");
const toggleTargetPc = document.getElementById("toggleTargetPc");
const toggleMobileSpeaker = document.getElementById("toggleMobileSpeaker");
const pillHearPcStatus = document.getElementById("pillHearPcStatus");
const pcAudioBadge = document.getElementById("pcAudioBadge");
const pcAudioBadgeText = document.getElementById("pcAudioBadgeText");
const btnTogglePcAudio = document.getElementById("btnTogglePcAudio");
const btnPcAudioIcon = document.getElementById("btnPcAudioIcon");
const btnPcAudioText = document.getElementById("btnPcAudioText");
const pcAudioVolume = document.getElementById("pcAudioVolume");
const pcAudioVolumeVal = document.getElementById("pcAudioVolumeVal");

let routingConfig = {
  target_pc_ip: "127.0.0.1",
  target_pc_port: 8001,
  target_pc_enabled: true,
  mobile_speaker_enabled: true
};
const liveToggleBtn = document.getElementById("liveToggleBtn");
const liveBtnText = document.getElementById("liveBtnText");
const chunkIntervalSelect = document.getElementById("chunkIntervalSelect");
const modelSelect = document.getElementById("modelSelect");
const pitchSlider = document.getElementById("pitchSlider");
const pitchValue = document.getElementById("pitchValue");
const voiceGainSlider = document.getElementById("voiceGainSlider");
const voiceGainValue = document.getElementById("voiceGainValue");
const algoSelect = document.getElementById("algoSelect");
const denoiseSelect = document.getElementById("denoiseSelect");
const denoiseBadge = document.getElementById("denoiseBadge");
const noiseGateSlider = document.getElementById("noiseGateSlider");
const noiseGateVal = document.getElementById("noiseGateVal");
const statNoiseFloor = document.getElementById("statNoiseFloor");
const statVoiceLevel = document.getElementById("statVoiceLevel");
const statSnrQuality = document.getElementById("statSnrQuality");
const calibrateRoomBtn = document.getElementById("calibrateRoomBtn");
const calStatusBadge = document.getElementById("calStatusBadge");
const calBtnIcon = document.getElementById("calBtnIcon");
const calBtnText = document.getElementById("calBtnText");
const calProgressWrap = document.getElementById("calProgressWrap");
const calProgressBar = document.getElementById("calProgressBar");
const calCountdownText = document.getElementById("calCountdownText");

let isCalibratingRoom = false;
let calibrationRmsSamples = [];

let ambientNoiseFloor = 0.015;  // Running estimate of background noise (RMS)
let speechPeakLevel = 0.050;    // Running estimate of user's voice level (RMS)
let autoDynamicGateThreshold = 0.020;
let gateMode = "auto";          // 'off', 'auto', 'manual'
let lastAcousticUiUpdate = 0;
let noiseGateThreshold = 0.0;
let gateGain = 1.0;
let gateHangoverFrames = 0;
const statLatency = document.getElementById("statLatency");
const statCompute = document.getElementById("statCompute");
const statSr = document.getElementById("statSr");
const audioStateTag = document.getElementById("audioStateTag");
const canvas = document.getElementById("visualizerCanvas");
const canvasCtx = canvas.getContext("2d");
const activityLog = document.getElementById("activityLog");
const clearLogBtn = document.getElementById("clearLogBtn");

// On-screen & remote logging
function logEvent(msg, type = "normal") {
  const time = new Date().toLocaleTimeString().split(" ")[0];
  const fullMsg = `[${time}] ${msg}`;
  console.log(fullMsg);

  if (activityLog) {
    const line = document.createElement("div");
    line.className = `log-line ${type}`;
    line.textContent = fullMsg;
    activityLog.appendChild(line);
    activityLog.scrollTop = activityLog.scrollHeight;
  }

  // Send to server terminal as well
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ action: "client_log", msg: msg }));
    } catch (e) {}
  }
}

if (clearLogBtn) {
  clearLogBtn.addEventListener("click", () => {
    activityLog.innerHTML = "";
  });
}

// Resize visualizer canvas
function resizeCanvas() {
  if (canvas) {
    const parent = canvas.parentElement;
    canvas.width = (parent && parent.clientWidth > 0) ? parent.clientWidth : window.innerWidth || 320;
    canvas.height = (parent && parent.clientHeight > 0) ? parent.clientHeight : 100;
  }
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ================= Microphone Permission & Initialization =================
async function checkExistingPermission() {
  logEvent("Checking browser environment and security context...");

  // 1. Insecure Context check (plain HTTP on mobile)
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!window.isSecureContext && window.location.protocol === "http:" && !isLocalhost) {
    logEvent("Insecure HTTP detected. Mobile browsers block microphone on HTTP!", "error");
    micPromptBanner.classList.remove("ready");
    micBannerTitle.textContent = "🔒 HTTPS Required for Microphone";
    micBannerSub.textContent = "Mobile Chrome blocks mic on plain HTTP. Tap to switch to HTTPS";
    enableMicBtn.textContent = "Switch to HTTPS";
    enableMicBtn.onclick = () => {
      window.location.href = `https://${window.location.hostname}:${window.location.port || 8000}`;
    };
    audioStateTag.textContent = "Switch to HTTPS";
    return;
  }

  // 2. Query Permissions API if supported
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const p = await navigator.permissions.query({ name: "microphone" });
      logEvent(`Microphone permission state: '${p.state}'`, "highlight");

      if (p.state === "granted") {
        logEvent("Permission already granted! Auto-activating microphone...", "success");
        await enableMicrophone(true);
        return;
      } else if (p.state === "denied") {
        logEvent("Microphone is blocked in site settings!", "error");
        micPromptBanner.classList.remove("ready");
        micBannerTitle.textContent = "Microphone Blocked in Settings";
        micBannerSub.textContent = "Tap 🔒 in browser address bar and enable Microphone";
        enableMicBtn.textContent = "Blocked";
        enableMicBtn.disabled = true;
        audioStateTag.textContent = "Mic Blocked";
        return;
      }

      p.onchange = () => {
        logEvent(`Permission changed to '${p.state}'`, "highlight");
        if (p.state === "granted") {
          enableMicrophone(true);
        }
      };
    } catch (e) {
      logEvent("Permissions query fallback: waiting for user tap", "warn");
    }
  }

  // Setup click handlers for manual activation
  enableMicBtn.onclick = () => enableMicrophone(false);
  micPromptBanner.onclick = () => enableMicrophone(false);
}

async function enableMicrophone(isAuto = false, forceReacquire = false) {
  if (micReady && mediaStream && !forceReacquire) {
    return true;
  }

  if (forceReacquire && mediaStream) {
    try {
      mediaStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    mediaStream = null;
    micReady = false;
  }

  logEvent(`Activating audio stream (auto=${isAuto}, force=${forceReacquire})...`);

  // Ensure AudioContext
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === "suspended") {
      await audioContext.resume();
      logEvent("AudioContext resumed.", "highlight");
    }
  } catch (e) {
    logEvent(`AudioContext init note: ${e.message}`, "warn");
  }

  const getMedia = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    ? (constraints) => navigator.mediaDevices.getUserMedia(constraints)
    : (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia);

  if (!getMedia) {
    logEvent("navigator.mediaDevices.getUserMedia is not available on this origin!", "error");
    micPromptBanner.classList.remove("ready");
    micBannerTitle.textContent = "Microphone API Unavailable";
    micBannerSub.textContent = "Please use HTTPS (https://" + window.location.host + ")";
    enableMicBtn.textContent = "Open HTTPS";
    enableMicBtn.onclick = () => {
      window.location.href = `https://${window.location.hostname}:${window.location.port || 8000}`;
    };
    return false;
  }

  try {
    if (!isAuto && !forceReacquire) {
      micBannerTitle.textContent = "Requesting Permission...";
      micBannerSub.textContent = "Please tap 'Allow' on the popup";
    }

    const isCall = (globalAudioMode === "call");
    logEvent(`Requesting getUserMedia (${isCall ? '📞 Call Mode: Echo Cancellation & Earpiece' : '🎵 Music Mode: Pure Stereo'})...`);

    // In Call Mode: echoCancellation & noiseSuppression = true tells Android this is a phone call.
    // Android automatically routes to the top Ear Speaker and engages hardware AEC!
    // In Music Mode: false keeps Android in full-fidelity Media Volume without ducking.
    mediaStream = await getMedia.call(navigator.mediaDevices || navigator, {
      audio: {
        echoCancellation: isCall,
        noiseSuppression: isCall,
        autoGainControl: false, // Prevents mobile browser from boosting fan noise during silence
      }
    });

    logEvent(`Microphone stream acquired! Tracks: ${mediaStream.getAudioTracks().length}`, "success");

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.4;

    const source = audioContext.createMediaStreamSource(mediaStream);
    // Connect directly to analyser so visualizer ALWAYS moves with speech
    source.connect(analyser);

    // 1. Hardware/WebAudio 75Hz High-Pass Filter (cuts fan rumble)
    const micHighpass = audioContext.createBiquadFilter();
    micHighpass.type = "highpass";
    micHighpass.frequency.value = 75;
    source.connect(micHighpass);

    // Continuous ScriptProcessor for buffering audio
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    micHighpass.connect(scriptProcessor);

    // Terminate ScriptProcessor into a dedicated zero-gain node so the browser
    // does NOT think the mic is physically feeding phone speakers (which triggers Call Mode)
    const micMuteNode = audioContext.createGain();
    micMuteNode.gain.value = 0.0;
    scriptProcessor.connect(micMuteNode);
    micMuteNode.connect(audioContext.destination);

    // Store in global window scope so V8 garbage collector NEVER destroys the nodes
    window._audioGraphNodes = { source, micHighpass, scriptProcessor, analyser, mediaStream, micMuteNode };

    scriptProcessor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const resampled = resampleAudio(input, audioContext.sampleRate, 16000);

      // Ensure output buffer is zeroed out to prevent phone speaker feedback
      const output = e.outputBuffer.getChannelData(0);
      output.fill(0);

      // 1. Continuous Acoustic Noise Floor & Voice Level Tracking
      let sumSq = 0;
      for (let i = 0; i < resampled.length; i++) {
        sumSq += resampled[i] * resampled[i];
      }
      const currentRms = Math.sqrt(sumSq / resampled.length);

      if (isCalibratingRoom) {
        calibrationRmsSamples.push(currentRms);
      }

      // Voice Activity Detection (VAD)
      const vadThresholdRatio = (vocalProfile === "creator") ? 1.25 : 1.7;
      const isSpeaking = currentRms > (ambientNoiseFloor * vadThresholdRatio);

      // Noise Floor Tracking with VAD Freeze:
      // CRITICAL: NEVER update noise floor during active speech!
      // Speech must never drag the noise floor up, completely eliminating quality loss during long speeches.
      if (!isSpeaking) {
        if (currentRms < ambientNoiseFloor) {
          ambientNoiseFloor = ambientNoiseFloor * 0.85 + currentRms * 0.15; // fast descent to quiet
        } else {
          ambientNoiseFloor = ambientNoiseFloor * 0.998 + currentRms * 0.002; // gentle drift only in confirmed room silence
        }
      }

      if (isSpeaking) {
        speechPeakLevel = speechPeakLevel * 0.9 + currentRms * 0.1;
      } else {
        speechPeakLevel = speechPeakLevel * 0.995;
      }

      // Auto-calculated optimal threshold based on current ceiling fan / room noise & profile
      if (vocalProfile === "creator") {
        // Ultra-sensitive threshold for quiet speech with fan on: never cuts off low voice!
        autoDynamicGateThreshold = ambientNoiseFloor * 1.12;
      } else {
        autoDynamicGateThreshold = ambientNoiseFloor * 1.40;
      }

      // 2. Active Gate Threshold resolution
      const effectiveThreshold = (gateMode === "auto") ? autoDynamicGateThreshold : noiseGateThreshold;

      // 3. Client-side Intelligent Noise Gate
      if (effectiveThreshold > 0) {
        let targetGateGain = 1.0;
        const requiredHangover = (vocalProfile === "creator") ? 18 : 12; // 450ms for soft voice, 300ms standard
        const softFloor = (vocalProfile === "creator") ? 0.45 : 0.35;    // gentler floor for soft speech

        if (currentRms >= effectiveThreshold) {
          gateHangoverFrames = requiredHangover;
          targetGateGain = 1.0;
        } else if (gateHangoverFrames > 0) {
          gateHangoverFrames--;
          targetGateGain = 1.0; // Keep open during syllables and word endings
        } else {
          targetGateGain = softFloor; // Gentle soft floor: never abruptly cuts or chips speech!
        }

        // Smoothly slew the gain to eliminate abrupt cutoff clicks
        for (let i = 0; i < resampled.length; i++) {
          gateGain += (targetGateGain - gateGain) * 0.05;
          resampled[i] *= gateGain;
        }
      }

      // 4. Update UI Acoustic Monitor every ~250ms
      const now = performance.now();
      if (now - lastAcousticUiUpdate > 250) {
        lastAcousticUiUpdate = now;
        const noiseDb = Math.round(20 * Math.log10(Math.max(ambientNoiseFloor, 1e-4)));
        const voiceDb = Math.round(20 * Math.log10(Math.max(speechPeakLevel, 1e-4)));
        const snrDb = Math.max(0, voiceDb - noiseDb);

        if (statNoiseFloor) statNoiseFloor.textContent = `${noiseDb} dB`;
        if (statVoiceLevel) statVoiceLevel.textContent = isSpeaking ? `${voiceDb} dB` : "Idle";
        if (statSnrQuality) {
          if (snrDb >= 16) {
            statSnrQuality.textContent = `+${snrDb} dB (Clear ✓)`;
            statSnrQuality.className = "acoustic-val snr-badge-optimal";
          } else if (snrDb >= 8) {
            statSnrQuality.textContent = `+${snrDb} dB (Good)`;
            statSnrQuality.className = "acoustic-val snr-badge-good";
          } else {
            statSnrQuality.textContent = isSpeaking ? `+${snrDb} dB (Speak Closer)` : "Calibrated ✓";
            statSnrQuality.className = "acoustic-val snr-badge-low";
          }
        }
      }

      if (isRecordingPtt) {
        pttAudioBuffer.push(...resampled);
      } else if (isLiveStreaming) {
        liveAudioBuffer.push(...resampled);
      }
    };

    micReady = true;
    micPromptBanner.classList.add("ready");
    micBannerTitle.textContent = "Microphone Active ✓";
    micBannerSub.textContent = "Tap 'Mute Mic' anytime to switch to pure Media Mode";
    enableMicBtn.textContent = "Mute Mic";
    enableMicBtn.disabled = false;
    enableMicBtn.onclick = toggleMicMute;
    audioStateTag.textContent = "Microphone Ready";

    logEvent("Microphone pipeline active and hot! Ready to talk.", "success");
    return true;
  } catch (err) {
    logEvent(`getUserMedia error: ${err.name} - ${err.message}`, "error");
    micPromptBanner.classList.remove("ready");
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      micBannerTitle.textContent = "Microphone Permission Denied";
      micBannerSub.textContent = "Tap 🔒 in browser address bar to allow microphone";
    } else {
      micBannerTitle.textContent = "Microphone Error";
      micBannerSub.textContent = err.message || "Could not access microphone";
    }
    enableMicBtn.textContent = "Retry";
    enableMicBtn.disabled = false;
    audioStateTag.textContent = "Permission Required";
    return false;
  }
}

// Microphone Standby / Mute Management (Returns phone to Media Volume)
let isMicMuted = false;

function toggleMicMute() {
  setMicMuted(!isMicMuted);
}

function setMicMuted(muted) {
  if (!micReady || !mediaStream) return;
  isMicMuted = muted;
  mediaStream.getAudioTracks().forEach(track => {
    track.enabled = !muted;
  });
  if (enableMicBtn) {
    enableMicBtn.textContent = muted ? "Unmute Mic" : "Mute Mic";
  }
  if (micBannerTitle) {
    micBannerTitle.textContent = muted ? "Microphone on Standby 🔇" : "Microphone Active ✓";
  }
  if (micBannerSub) {
    micBannerSub.textContent = muted ? "Tap 'Unmute Mic' to talk anytime" : "Tap 'Mute Mic' anytime to switch to pure Media Mode";
  }
  if (audioStateTag) {
    audioStateTag.textContent = muted ? "Mic Standby" : "Microphone Ready";
  }
  logEvent(muted ? "🔇 Microphone on standby (phone returns to Media Volume)." : "🎙️ Microphone unmuted and active.", "highlight");
}

function stopMicrophone() {
  if (mediaStream) {
    try {
      mediaStream.getTracks().forEach(track => {
        track.stop(); // CRITICAL: This terminates Android AudioRecord thread and forces Android to drop In-Call mode!
      });
    } catch (e) {}
    mediaStream = null;
  }
  micReady = false;

  // Cleanly disconnect old Web Audio nodes to avoid ghost callbacks
  if (window._audioGraphNodes) {
    try {
      if (window._audioGraphNodes.source) window._audioGraphNodes.source.disconnect();
      if (window._audioGraphNodes.micHighpass) window._audioGraphNodes.micHighpass.disconnect();
      if (window._audioGraphNodes.scriptProcessor) {
        window._audioGraphNodes.scriptProcessor.disconnect();
        window._audioGraphNodes.scriptProcessor.onaudioprocess = null;
      }
      if (window._audioGraphNodes.micMuteNode) window._audioGraphNodes.micMuteNode.disconnect();
    } catch (e) {}
    window._audioGraphNodes = null;
  }

  if (micPromptBanner) micPromptBanner.classList.remove("ready");
  if (micBannerTitle) micBannerTitle.textContent = "Microphone on Standby 🔇";
  if (micBannerSub) micBannerSub.textContent = "Tap to enable microphone";
  if (enableMicBtn) {
    enableMicBtn.textContent = "Activate Mic";
    enableMicBtn.disabled = false;
    enableMicBtn.onclick = () => enableMicrophone(false, true);
  }
  if (audioStateTag) audioStateTag.textContent = "Mic Standby";
}

// Global Audio Profile Management (Call Mode vs Music Mode)
async function setGlobalAudioMode(mode, syncPcAudio = true) {
  if (mode !== "call" && mode !== "music") return;
  globalAudioMode = mode;

  if (btnGlobalCallMode) {
    btnGlobalCallMode.classList.toggle("active", mode === "call");
  }
  if (btnGlobalMusicMode) {
    btnGlobalMusicMode.classList.toggle("active", mode === "music");
  }

  if (globalModeBadge) {
    if (mode === "call") {
      globalModeBadge.textContent = "📞 Call Mode (AEC & Earpiece)";
      globalModeBadge.className = "global-mode-pill call";
    } else {
      globalModeBadge.textContent = "🎵 Music Mode (Hi-Fi & Media Vol)";
      globalModeBadge.className = "global-mode-pill music";
    }
  }

  // Update PC Audio listening DSP graph (Call Mode clarity vs Pure Music bypass)
  if (typeof relinkPcAudioGraph === "function") {
    relinkPcAudioGraph();
  }

  if (mode === "music") {
    // 🎵 In Music Mode: Stop the microphone completely!
    // This terminates Android's AudioRecord thread, forcing Android to immediately drop Call Mode
    // and switch the physical volume buttons to MEDIA VOLUME!
    stopMicrophone();
    logEvent("🎵 Switched to Music Mode! Phone volume buttons switched to MEDIA VOLUME. Full 48kHz stereo active (Zero AEC).", "success");
  } else {
    // 📞 In Call Mode: Stop and re-acquire microphone with echoCancellation: true
    // This forces Android into MODE_IN_COMMUNICATION, activating the earpiece & hardware AEC!
    stopMicrophone();
    await enableMicrophone(true, true);
    logEvent("📞 Switched to Call Mode! Phone Ear Speaker & hardware Echo Cancellation (AEC) active for private calls.", "success");
  }
}

if (btnGlobalCallMode) {
  btnGlobalCallMode.addEventListener("click", () => setGlobalAudioMode("call"));
}
if (btnGlobalMusicMode) {
  btnGlobalMusicMode.addEventListener("click", () => setGlobalAudioMode("music"));
}

// ================= WebSocket Management =================
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  logEvent(`Connecting WebSocket to ${wsUrl}...`);
  statusText.textContent = "Connecting...";
  statusBadge.className = "status-badge disconnected";

  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    logEvent("WebSocket connected!", "success");
    statusText.textContent = "Online";
    statusBadge.className = "status-badge connected";
    startHeartbeat();
  };

  ws.onmessage = async (event) => {
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

  ws.onclose = () => {
    logEvent("WebSocket disconnected. Retrying in 2s...", "warn");
    statusText.textContent = "Disconnected";
    statusBadge.className = "status-badge disconnected";
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (err) => {
    logEvent("WebSocket error occurred", "error");
    ws.close();
  };
}

let lastMeta = null;
function handleServerMessage(msg) {
  if (msg.type === "connected") {
    logEvent(`Loaded models from server: ${JSON.stringify(msg.available_models)}`, "highlight");
    modelSelect.innerHTML = "";
    (msg.available_models || []).forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m.replace(/_/g, " ");
      if (m === msg.current_model) opt.selected = true;
      modelSelect.appendChild(opt);
    });
    if (msg.pitch_lvl !== undefined) {
      pitchSlider.value = msg.pitch_lvl;
      updatePitchLabel(msg.pitch_lvl);
    }
    if (msg.volume_gain !== undefined && voiceGainSlider) {
      const pct = Math.round(msg.volume_gain * 100);
      voiceGainSlider.value = pct;
      updateVoiceGainLabel(pct);
    }
    if (msg.denoise_mode && denoiseSelect) {
      denoiseSelect.value = msg.denoise_mode;
      updateDenoiseBadge(msg.denoise_mode);
    }
    if (msg.vocal_profile) {
      setVocalProfile(msg.vocal_profile, false);
    }
    if (msg.calibrated_noise_db !== undefined && msg.calibrated_noise_db !== null) {
      const isFan = msg.calibrated_env === "fan_on";
      if (calStatusBadge) {
        calStatusBadge.className = `cal-badge ${isFan ? "fan" : "quiet"}`;
        calStatusBadge.textContent = `${isFan ? "Fan ON" : "Quiet"} (${Math.round(msg.calibrated_noise_db)} dB)`;
      }
    }
    if (msg.routing) {
      syncRoutingFromState(msg.routing);
    }
  } else if (msg.type === "room_calibrated") {
    if (calStatusBadge) {
      const isFan = msg.calibrated_env === "fan_on";
      calStatusBadge.className = `cal-badge ${isFan ? "fan" : "quiet"}`;
      calStatusBadge.textContent = `${isFan ? "Fan ON" : "Quiet"} (${Math.round(msg.calibrated_noise_db)} dB)`;
    }
    logEvent(msg.msg, "success");
  } else if (msg.type === "vocal_profile_updated") {
    if (msg.vocal_profile) {
      setVocalProfile(msg.vocal_profile, false);
    }
  } else if (msg.type === "config_updated") {
    if (msg.volume_gain !== undefined && voiceGainSlider) {
      const pct = Math.round(msg.volume_gain * 100);
      voiceGainSlider.value = pct;
      updateVoiceGainLabel(pct);
    }
    if (msg.denoise_mode && denoiseSelect) {
      denoiseSelect.value = msg.denoise_mode;
      updateDenoiseBadge(msg.denoise_mode);
    }
    if (msg.pitch_lvl !== undefined) {
      pitchSlider.value = msg.pitch_lvl;
      updatePitchLabel(msg.pitch_lvl);
    }
  } else if (msg.type === "target_pc_status") {
    handleTargetPcStatus(msg);
  } else if (msg.type === "routing_updated") {
    syncRoutingFromState(msg.routing);
  } else if (msg.type === "pong") {
    const rtt = Math.round(performance.now() - msg.time);
    statLatency.textContent = `${rtt} ms`;
  } else if (msg.type === "progress") {
    logEvent(`⚡ Server: ${msg.msg}`, "highlight");
    if (audioStateTag) audioStateTag.textContent = msg.msg;
  } else if (msg.type === "audio_chunk") {
    lastMeta = msg;
    logEvent(`AI conversion completed in ${msg.proc_time_sec}s!`, "success");
    if (msg.proc_time_sec !== undefined) {
      statCompute.textContent = `${msg.proc_time_sec}s`;
    }
    if (msg.sample_rate) {
      statSr.textContent = `${msg.sample_rate.toLocaleString()} Hz`;
    }
    if (msg.target_pc_enabled) {
      logEvent(`📡 Stream delivered to Target PC Virtual Mic!`, "highlight");
    }
    if (msg.mobile_speaker_enabled === false) {
      pttBtn.classList.remove("processing");
      pttLabel.textContent = "Hold or Tap to Talk";
      audioStateTag.textContent = "Sent to Target PC Mic ✓";
    }
  }
}

function startHeartbeat() {
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "ping", time: performance.now() }));
    }
  }, 3000);
}

// Resampler
function resampleAudio(audio, origSr, targetSr) {
  if (origSr === targetSr) return audio;
  const ratio = origSr / targetSr;
  const newLen = Math.round(audio.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const origIndex = i * ratio;
    const i1 = Math.floor(origIndex);
    const i2 = Math.min(i1 + 1, audio.length - 1);
    const weight = origIndex - i1;
    result[i] = audio[i1] * (1 - weight) + audio[i2] * weight;
  }
  return result;
}

function floatTo16BitPCM(floatArray) {
  const buffer = new ArrayBuffer(floatArray.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < floatArray.length; i++) {
    let s = Math.max(-1, Math.min(1, floatArray[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

let currentVoiceSource = null;

// Play received PCM audio from server
function handleAudioOutput(arrayBuffer) {
  // In Live Streaming mode: audio is streamed strictly to Target PC Virtual Mic (Discord/Calls).
  // The phone does NOT play the converted voice back into the user's ears, completely eliminating any feedback loop!
  if (currentMode === "live" || isLiveStreaming) {
    if (audioStateTag) {
      audioStateTag.textContent = "Live Stream ➔ PC Mic (Discord Active ✓)";
    }
    return;
  }

  // Walkie-Talkie (PTT) Mode: play converted voice through phone speaker/headphones for voice monitoring!
  if (!routingConfig.mobile_speaker_enabled) {
    pttBtn.classList.remove("processing");
    pttLabel.textContent = "Hold or Tap to Talk";
    audioStateTag.textContent = "Sent to Target PC Mic ✓";
    return;
  }
  if (!audioContext) return;

  const sr = (lastMeta && lastMeta.sample_rate) || 40000;
  const int16Array = new Int16Array(arrayBuffer);
  const floatArray = new Float32Array(int16Array.length);

  for (let i = 0; i < int16Array.length; i++) {
    floatArray[i] = int16Array[i] / 32768.0;
  }

  const audioBuf = audioContext.createBuffer(1, floatArray.length, sr);
  audioBuf.copyToChannel(floatArray, 0);

  // Cancel any previously playing utterance so voices never overlap or echo!
  if (currentVoiceSource) {
    try { currentVoiceSource.stop(); } catch(e) {}
    currentVoiceSource = null;
  }

  const source = audioContext.createBufferSource();
  source.buffer = audioBuf;
  source.connect(analyser);
  source.connect(audioContext.destination);

  currentVoiceSource = source;
  const startTime = audioContext.currentTime;
  source.start(startTime);
  nextPlayTime = startTime + audioBuf.duration;

  pttBtn.classList.remove("processing");
  pttLabel.textContent = "Hold or Tap to Talk";
  audioStateTag.textContent = "Playing Target Voice";
  logEvent(`Playing ${audioBuf.duration.toFixed(2)}s converted female voice!`, "highlight");

  source.onended = () => {
    if (currentVoiceSource === source) {
      currentVoiceSource = null;
    }
    if (!isRecordingPtt && !isLiveStreaming) {
      audioStateTag.textContent = "Microphone Ready";
    }
  };
}

// ================= Push-to-Talk Interactions =================
async function startRecording() {
  if (audioContext && audioContext.state === "suspended") {
    try { await audioContext.resume(); } catch(e) {}
  }
  if (!micReady) {
    logEvent("Mic not ready yet, requesting activation...", "warn");
    await enableMicrophone(false);
    return;
  }
  isRecordingPtt = true;
  pttAudioBuffer = [];
  pttBtn.classList.add("active");
  pttBtn.classList.remove("processing");
  pttLabel.textContent = "Recording...";
  audioStateTag.textContent = "Listening to your voice...";
  logEvent("Recording started... Speak into your phone mic!", "highlight");
}

function stopRecording() {
  if (!isRecordingPtt) return;
  isRecordingPtt = false;
  pttBtn.classList.remove("active");

  const durationSec = pttAudioBuffer.length / 16000.0;
  logEvent(`Recording stopped. Captured ${durationSec.toFixed(2)}s (${pttAudioBuffer.length} samples).`);

  if (pttAudioBuffer.length < 3200) {
    pttLabel.textContent = "Hold or Tap to Talk";
    audioStateTag.textContent = "Too short (speak longer)";
    logEvent("Speech was under 0.2s, discarded. Please hold longer.", "warn");
    pttAudioBuffer = [];
    return;
  }

  pttBtn.classList.add("processing");
  pttLabel.textContent = "Transforming...";
  audioStateTag.textContent = "Processing Female Voice...";

  const pcmBytes = floatTo16BitPCM(pttAudioBuffer);
  logEvent(`Sending ${pcmBytes.byteLength} bytes to RVC server...`, "highlight");
  pttAudioBuffer = [];
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(pcmBytes);
    logEvent("Audio transmitted. Server is converting...", "highlight");
  } else {
    logEvent("WebSocket not open! Cannot send audio.", "error");
  }
}

// Global AudioContext unlocker on any user touch
function unlockAudioContext() {
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume().then(() => {
      logEvent("AudioContext active and running!", "success");
    }).catch(() => {});
  }
}
document.addEventListener("touchstart", unlockAudioContext, { passive: true });
document.addEventListener("mousedown", unlockAudioContext, { passive: true });

// Support both Hold-to-Talk and Tap-to-Talk
let pressStartTime = 0;
let isHolding = false;
let isTouchTriggered = false;

function handlePressStart(e) {
  if (e && e.cancelable) e.preventDefault();
  unlockAudioContext();

  if (!micReady) {
    enableMicrophone(false);
    return;
  }

  // If already recording in tap-to-talk mode, a second press stops recording
  if (isRecordingPtt && !isHolding) {
    stopRecording();
    return;
  }

  pressStartTime = Date.now();
  isHolding = true;
  startRecording();
}

function handlePressEnd(e) {
  if (e && e.cancelable) e.preventDefault();
  if (!isHolding) return;
  isHolding = false;
  const holdDuration = Date.now() - pressStartTime;

  if (holdDuration >= 400) {
    // True hold-to-talk: user held button down and released
    stopRecording();
  } else {
    // Short tap (< 400ms): lock in recording mode!
    pttLabel.textContent = "Tap to Stop";
    audioStateTag.textContent = "Recording (Tap to Stop)...";
    logEvent("Tap-to-talk active: speaking... Tap button again when done.", "highlight");
  }
}

// Touch events for mobile
pttBtn.addEventListener("touchstart", (e) => {
  isTouchTriggered = true;
  handlePressStart(e);
}, { passive: false });

pttBtn.addEventListener("touchend", (e) => {
  handlePressEnd(e);
  setTimeout(() => { isTouchTriggered = false; }, 400);
}, { passive: false });

pttBtn.addEventListener("touchcancel", (e) => {
  handlePressEnd(e);
  setTimeout(() => { isTouchTriggered = false; }, 400);
}, { passive: false });

// Desktop mouse listeners (ignored on touch devices)
pttBtn.addEventListener("mousedown", (e) => {
  if (isTouchTriggered) return;
  handlePressStart(e);
});

window.addEventListener("mouseup", (e) => {
  if (isTouchTriggered) return;
  if (isHolding) handlePressEnd(e);
});

// Suppress synthetic click on mobile so it doesn't double-fire
pttBtn.addEventListener("click", (e) => {
  e.preventDefault();
  if (!isTouchTriggered && !isHolding && !isRecordingPtt) {
    handlePressStart(e);
  }
});

// ================= Live Streaming Interactions =================
let liveAudioBuffer = [];
async function toggleLiveStream() {
  if (isLiveStreaming) {
    isLiveStreaming = false;
    clearInterval(liveIntervalTimer);
    liveToggleBtn.classList.remove("streaming");
    liveToggleBtn.classList.add("start");
    liveBtnText.textContent = "Start Live Conversion";
    audioStateTag.textContent = "Microphone Ready";
    logEvent("Live stream stopped.");
  } else {
    const ok = await enableMicrophone(false);
    if (!ok) return;

    isLiveStreaming = true;
    liveAudioBuffer = [];
    liveToggleBtn.classList.add("streaming");
    liveToggleBtn.classList.remove("start");
    liveBtnText.textContent = "Stop Live Conversion";
    audioStateTag.textContent = "Live Streaming...";
    logEvent(`Live stream started! Sending chunks every ${liveChunkInterval}s...`, "highlight");

    liveIntervalTimer = setInterval(() => {
      if (liveAudioBuffer.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
        const pcmBytes = floatTo16BitPCM(liveAudioBuffer);
        logEvent(`Live chunk sending (${(liveAudioBuffer.length / 16000).toFixed(2)}s)...`);
        ws.send(pcmBytes);
        liveAudioBuffer = [];
      }
    }, liveChunkInterval * 1000);
  }
}
liveToggleBtn.addEventListener("click", toggleLiveStream);

chunkIntervalSelect.addEventListener("change", (e) => {
  liveChunkInterval = parseFloat(e.target.value);
  logEvent(`Chunk interval set to ${liveChunkInterval}s`);
  if (isLiveStreaming) {
    toggleLiveStream();
    toggleLiveStream();
  }
});

// Engine Mode Switching
let currentEngineMode = "dsp";

function setEngineMode(mode) {
  currentEngineMode = mode;
  if (mode === "dsp") {
    engineDspBtn.classList.add("active");
    engineRvcBtn.classList.remove("active");
    logEvent("⚡ Switched to Instant Fast Mode (0.2s)", "success");
  } else {
    engineRvcBtn.classList.add("active");
    engineDspBtn.classList.remove("active");
    logEvent("🧠 Switched to RVC AI Model (Neural Voice)", "highlight");
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "set_engine_mode", mode: mode }));
  }
}

if (engineDspBtn) engineDspBtn.addEventListener("click", () => setEngineMode("dsp"));
if (engineRvcBtn) engineRvcBtn.addEventListener("click", () => setEngineMode("rvc"));

// Vocal Profile Switching (Standard vs Creator Profile)
function setVocalProfile(profile, sendWs = true) {
  vocalProfile = (profile === "creator") ? "creator" : "standard";
  if (vocalProfile === "creator") {
    if (profileCreatorBtn) profileCreatorBtn.classList.add("active");
    if (profileStandardBtn) profileStandardBtn.classList.remove("active");
    if (profileStatusBadge) {
      profileStatusBadge.textContent = "Creator Mode";
      profileStatusBadge.className = "profile-badge creator";
    }
    logEvent("✨ Creator Profile Active: Soft Voice Boost + De-Hiss + De-Breath", "highlight");
  } else {
    if (profileStandardBtn) profileStandardBtn.classList.add("active");
    if (profileCreatorBtn) profileCreatorBtn.classList.remove("active");
    if (profileStatusBadge) {
      profileStatusBadge.textContent = "Standard";
      profileStatusBadge.className = "profile-badge standard";
    }
    logEvent("🌐 Switched to Standard Voice Profile (Universal)", "success");
  }
  if (sendWs && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "set_vocal_profile", profile: vocalProfile }));
  }
}

if (profileStandardBtn) profileStandardBtn.addEventListener("click", () => setVocalProfile("standard"));
if (profileCreatorBtn) profileCreatorBtn.addEventListener("click", () => setVocalProfile("creator"));

// Room Noise Calibration (1.5-second silent ambient learning)
async function startRoomCalibration() {
  if (isCalibratingRoom) return;

  if (!micReady) {
    const ok = await initMicrophone();
    if (!ok) return;
  }

  isCalibratingRoom = true;
  calibrationRmsSamples = [];

  if (calibrateRoomBtn) calibrateRoomBtn.disabled = true;
  if (calProgressWrap) calProgressWrap.style.display = "flex";
  if (calStatusBadge) {
    calStatusBadge.className = "cal-badge listening";
    calStatusBadge.textContent = "Listening...";
  }
  if (calBtnText) calBtnText.textContent = "Sampling room noise...";

  const startTime = performance.now();
  const totalDuration = 1500; // 1.5 seconds

  const progressInterval = setInterval(() => {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(100, (elapsed / totalDuration) * 100);
    const remaining = Math.max(0, ((totalDuration - elapsed) / 1000)).toFixed(1);

    if (calProgressBar) calProgressBar.style.width = `${progress}%`;
    if (calCountdownText) calCountdownText.textContent = `Listening to room... stay silent (${remaining}s)`;

    if (elapsed >= totalDuration) {
      clearInterval(progressInterval);
      finishRoomCalibration();
    }
  }, 50);
}

function finishRoomCalibration() {
  isCalibratingRoom = false;

  let avgRms = 0.005;
  if (calibrationRmsSamples.length > 0) {
    // Sort and take 50th percentile (median) to ignore any tiny accidental tap
    const sorted = [...calibrationRmsSamples].sort((a, b) => a - b);
    avgRms = sorted[Math.floor(sorted.length * 0.5)];
  }

  const noiseDb = Math.round(20 * Math.log10(Math.max(avgRms, 1e-4)));
  ambientNoiseFloor = avgRms; // Immediately calibrate the client noise tracker

  let detectedMode = "quiet";
  if (noiseDb > -54) {
    detectedMode = "fan_on";
    if (calStatusBadge) {
      calStatusBadge.className = "cal-badge fan";
      calStatusBadge.textContent = `Fan ON (${noiseDb} dB)`;
    }
    logEvent(`🎯 Room Calibrated: ${noiseDb} dBFS -> Fan ON Mode Activated (+4dB Forward Vocal Boost)`, "highlight");
  } else {
    detectedMode = "quiet";
    if (calStatusBadge) {
      calStatusBadge.className = "cal-badge quiet";
      calStatusBadge.textContent = `Quiet (${noiseDb} dB)`;
    }
    logEvent(`🎯 Room Calibrated: ${noiseDb} dBFS -> Quiet Room Mode Activated (Pure Transparent)`, "success");
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: "calibrate_room",
      noise_db: noiseDb,
      mode: detectedMode
    }));
  }

  if (calCountdownText) {
    calCountdownText.textContent = `Calibrated ✓ Noise: ${noiseDb} dB (${detectedMode === "fan_on" ? "Fan ON" : "Quiet Room"})`;
  }

  setTimeout(() => {
    if (calProgressWrap) calProgressWrap.style.display = "none";
    if (calProgressBar) calProgressBar.style.width = "0%";
    if (calibrateRoomBtn) {
      calibrateRoomBtn.disabled = false;
      if (calBtnText) calBtnText.textContent = "Re-Calibrate Room (1.5s)";
    }
  }, 1200);
}

if (calibrateRoomBtn) {
  calibrateRoomBtn.addEventListener("click", startRoomCalibration);
}

// Mode Switching
modePttBtn.addEventListener("click", () => {
  currentMode = "ptt";
  modePttBtn.classList.add("active");
  modeLiveBtn.classList.remove("active");
  modeTargetBtn.classList.remove("active");
  pttSection.classList.remove("hidden");
  liveSection.classList.add("hidden");
  targetSection.classList.add("hidden");
  if (isLiveStreaming) toggleLiveStream();
  logEvent("Switched to Walkie-Talkie (PTT) mode");
});

modeLiveBtn.addEventListener("click", () => {
  currentMode = "live";
  modeLiveBtn.classList.add("active");
  modePttBtn.classList.remove("active");
  modeTargetBtn.classList.remove("active");
  liveSection.classList.remove("hidden");
  pttSection.classList.add("hidden");
  targetSection.classList.add("hidden");
  logEvent("Switched to Live Streaming mode");
});

modeTargetBtn.addEventListener("click", () => {
  currentMode = "target";
  modeTargetBtn.classList.add("active");
  modePttBtn.classList.remove("active");
  modeLiveBtn.classList.remove("active");
  targetSection.classList.remove("hidden");
  pttSection.classList.add("hidden");
  liveSection.classList.add("hidden");
  if (isLiveStreaming) toggleLiveStream();
  logEvent("Switched to PC Virtual Mic Setup");
});

if (routingStatusPill) {
  routingStatusPill.style.cursor = "pointer";
  routingStatusPill.addEventListener("click", () => {
    modeTargetBtn.click();
  });
}

// ================= Target PC Virtual Mic Routing & Verification =================
function updateRoutingPills() {
  if (pillTargetStatus) {
    if (routingConfig.target_pc_enabled) {
      pillTargetStatus.textContent = "🖥️ PC Mic: ON";
      pillTargetStatus.className = "pill-badge active";
    } else {
      pillTargetStatus.textContent = "🖥️ PC Mic: OFF";
      pillTargetStatus.className = "pill-badge disabled";
    }
  }
  if (pillMobileStatus) {
    if (routingConfig.mobile_speaker_enabled) {
      pillMobileStatus.textContent = "📱 Mobile: ON";
      pillMobileStatus.className = "pill-badge active";
    } else {
      pillMobileStatus.textContent = "📱 Mobile: OFF";
      pillMobileStatus.className = "pill-badge disabled";
    }
  }
}

function syncRoutingFromState(cfg) {
  if (!cfg) return;
  routingConfig = { ...routingConfig, ...cfg };
  if (targetIpInput) targetIpInput.value = routingConfig.target_pc_ip || "127.0.0.1";
  if (targetPortInput) targetPortInput.value = routingConfig.target_pc_port || 8001;
  if (toggleTargetPc) toggleTargetPc.checked = !!routingConfig.target_pc_enabled;
  if (toggleMobileSpeaker) toggleMobileSpeaker.checked = !!routingConfig.mobile_speaker_enabled;
  updateRoutingPills();
}

function sendRoutingUpdate() {
  const ip = targetIpInput ? targetIpInput.value.trim() : routingConfig.target_pc_ip;
  const port = targetPortInput ? parseInt(targetPortInput.value) || 8001 : routingConfig.target_pc_port;
  const targetEnabled = toggleTargetPc ? toggleTargetPc.checked : routingConfig.target_pc_enabled;
  const mobileEnabled = toggleMobileSpeaker ? toggleMobileSpeaker.checked : routingConfig.mobile_speaker_enabled;

  routingConfig.target_pc_ip = ip;
  routingConfig.target_pc_port = port;
  routingConfig.target_pc_enabled = targetEnabled;
  routingConfig.mobile_speaker_enabled = mobileEnabled;

  updateRoutingPills();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: "update_routing",
      target_pc_ip: ip,
      target_pc_port: port,
      target_pc_enabled: targetEnabled,
      mobile_speaker_enabled: mobileEnabled
    }));
  }
  logEvent(`Audio Routing: Target PC = ${targetEnabled ? 'ON' : 'OFF'}, Mobile = ${mobileEnabled ? 'ON' : 'OFF'}`);
}

let verifyTimeoutTimer = null;
function verifyTargetPC() {
  const ip = targetIpInput ? targetIpInput.value.trim() : "127.0.0.1";
  const port = targetPortInput ? parseInt(targetPortInput.value) || 8001 : 8001;

  logEvent(`🔍 Testing communication with Target PC driver at http://${ip}:${port}...`, "highlight");
  
  if (targetVerifyBadge) {
    targetVerifyBadge.className = "verify-badge verifying";
    if (targetVerifyText) targetVerifyText.textContent = "Testing...";
  }
  if (btnVerifyTarget) {
    btnVerifyTarget.disabled = true;
    if (verifySpinner) verifySpinner.classList.remove("hidden");
    if (verifyBtnIcon) verifyBtnIcon.textContent = "⏳";
    if (verifyBtnText) verifyBtnText.textContent = "Checking Driver...";
  }
  if (detailsDriverStatus) {
    detailsDriverStatus.textContent = "Connecting to receiver agent...";
    detailsDriverStatus.className = "details-val text-muted";
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: "verify_target_pc",
      ip: ip,
      port: port
    }));
  } else {
    fetch(`/api/target_pc/verify?ip=${encodeURIComponent(ip)}&port=${port}`)
      .then(res => res.json())
      .then(data => handleTargetPcStatus(data))
      .catch(err => handleTargetPcStatus({ success: false, details: err.message, ip, port }));
  }

  clearTimeout(verifyTimeoutTimer);
  verifyTimeoutTimer = setTimeout(() => {
    if (btnVerifyTarget && btnVerifyTarget.disabled) {
      handleTargetPcStatus({
        success: false,
        ip: ip,
        port: port,
        details: "Timed out waiting for response"
      });
    }
  }, 4000);
}

function handleTargetPcStatus(data) {
  clearTimeout(verifyTimeoutTimer);
  if (btnVerifyTarget) {
    btnVerifyTarget.disabled = false;
    if (verifySpinner) verifySpinner.classList.add("hidden");
    if (verifyBtnIcon) verifyBtnIcon.textContent = "🔍";
    if (verifyBtnText) verifyBtnText.textContent = "Verify Driver & Connection";
  }

  if (data.success) {
    if (targetVerifyBadge) {
      targetVerifyBadge.className = "verify-badge verified";
      if (targetVerifyText) targetVerifyText.textContent = "Connected ✓";
    }
    if (detailsDriverStatus) {
      detailsDriverStatus.textContent = "🟢 Online & Virtual Mic Ready";
      detailsDriverStatus.className = "details-val";
      detailsDriverStatus.style.color = "#34d399";
    }
    const details = data.details || {};
    if (detailsPlatform) {
      detailsPlatform.textContent = details.platform || "Active";
      detailsPlatform.className = "details-val";
    }
    if (detailsVirtualMic) {
      detailsVirtualMic.textContent = details.virtual_mic || "VoiceMorph Virtual Microphone";
      detailsVirtualMic.className = "details-val";
    }
    logEvent(`✅ Target PC Verified at ${data.ip}:${data.port}! Virtual Mic ready for Discord.`, "success");
  } else {
    if (targetVerifyBadge) {
      targetVerifyBadge.className = "verify-badge offline";
      if (targetVerifyText) targetVerifyText.textContent = "Offline ✗";
    }
    if (detailsDriverStatus) {
      detailsDriverStatus.textContent = "🔴 Unreachable (Driver Not Running)";
      detailsDriverStatus.className = "details-val";
      detailsDriverStatus.style.color = "#f87171";
    }
    if (detailsPlatform) {
      detailsPlatform.textContent = "Unreachable";
      detailsPlatform.className = "details-val text-muted";
    }
    logEvent(`❌ Target PC at ${data.ip}:${data.port} unreachable (${data.details || "Connection refused"}). Start receiver first!`, "error");
  }
}

if (btnVerifyTarget) {
  btnVerifyTarget.addEventListener("click", verifyTargetPC);
}

if (btnQuickLocalhost) {
  btnQuickLocalhost.addEventListener("click", () => {
    if (targetIpInput) targetIpInput.value = "127.0.0.1";
    sendRoutingUpdate();
    verifyTargetPC();
  });
}

if (targetIpInput) targetIpInput.addEventListener("change", sendRoutingUpdate);
if (targetPortInput) targetPortInput.addEventListener("change", sendRoutingUpdate);
if (toggleTargetPc) toggleTargetPc.addEventListener("change", sendRoutingUpdate);
if (toggleMobileSpeaker) toggleMobileSpeaker.addEventListener("change", sendRoutingUpdate);

// ================= Target PC Wireless Audio Streaming =================
const pcAudioFmtBadge = document.getElementById("pcAudioFmtBadge");

let pcAudioWs = null;
let isListeningPcAudio = false;
let pcAudioVol = 1.0;
let pcAudioNextTime = 0;
let pcAudioSampleRate = 48000;
let pcAudioChannels = 2;
const pcAudioJitterSec = 0.200; // 200ms rock-solid cushion prevents all packet starvation
let pcAudioIsFirstChunk = true;

// Web Audio DSP Nodes
let pcAudioGain = null;
let pcAudioHighpass = null;
let pcAudioPresence = null;
let pcAudioCompressor = null;
let pcAudioInputNode = null;

function initPcAudioGraph() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (!pcAudioGain) {
    pcAudioGain = audioContext.createGain();
    pcAudioGain.gain.value = pcAudioVol;
    pcAudioGain.connect(audioContext.destination);
  }

  // Create Call Mode DSP Nodes (lazy init)
  if (!pcAudioHighpass) {
    // 85Hz Low-Cut: removes desk rumbles, fan drone, and mic handling thumps from peers
    pcAudioHighpass = audioContext.createBiquadFilter();
    pcAudioHighpass.type = "highpass";
    pcAudioHighpass.frequency.value = 85;
    pcAudioHighpass.Q.value = 0.707;
  }

  if (!pcAudioPresence) {
    // 2.8kHz Vocal Presence Lift (+3.5 dB): brings vocal consonants ('s', 't', 'k') forward
    pcAudioPresence = audioContext.createBiquadFilter();
    pcAudioPresence.type = "peaking";
    pcAudioPresence.frequency.value = 2800;
    pcAudioPresence.gain.value = 3.5;
    pcAudioPresence.Q.value = 1.0;
  }

  if (!pcAudioCompressor) {
    // Dynamic Speech Leveler: boosts soft teammates while catching loud screams
    pcAudioCompressor = audioContext.createDynamicsCompressor();
    pcAudioCompressor.threshold.value = -24; // dB
    pcAudioCompressor.knee.value = 10; // dB
    pcAudioCompressor.ratio.value = 4.0;
    pcAudioCompressor.attack.value = 0.005; // 5ms
    pcAudioCompressor.release.value = 0.150; // 150ms
  }

  relinkPcAudioGraph();
}

function relinkPcAudioGraph() {
  if (!pcAudioGain || !audioContext) return;

  try {
    if (pcAudioHighpass) pcAudioHighpass.disconnect();
    if (pcAudioPresence) pcAudioPresence.disconnect();
    if (pcAudioCompressor) pcAudioCompressor.disconnect();
  } catch (e) {}

  if (globalAudioMode === "call") {
    // 📞 Call Mode DSP Chain:
    // Input -> Highpass (85Hz) -> Presence (+3.5dB @ 2.8kHz) -> Compressor -> Gain -> Destination
    pcAudioHighpass.connect(pcAudioPresence);
    pcAudioPresence.connect(pcAudioCompressor);
    pcAudioCompressor.connect(pcAudioGain);
    pcAudioInputNode = pcAudioHighpass;
  } else {
    // 🎵 Music Mode: 100% Pure Untouched Hi-Fi Stereo Bypass -> Gain -> Destination
    pcAudioInputNode = pcAudioGain;
  }
}

function updatePcAudioUI(active) {
  if (pcAudioBadge) {
    pcAudioBadge.className = active ? "verify-badge verified" : "verify-badge unverified";
  }
  if (pcAudioBadgeText) {
    pcAudioBadgeText.textContent = active ? "Listening 🔊" : "Muted";
  }
  if (pillHearPcStatus) {
    pillHearPcStatus.textContent = active ? "🎧 Hear PC: ON" : "🎧 Hear PC: OFF";
    pillHearPcStatus.className = active ? "pill-badge active" : "pill-badge disabled";
  }
  if (btnTogglePcAudio) {
    if (active) {
      btnTogglePcAudio.classList.add("active");
      if (btnPcAudioIcon) btnPcAudioIcon.textContent = "⏹";
      if (btnPcAudioText) btnPcAudioText.textContent = "Stop Listening to PC Audio";
    } else {
      btnTogglePcAudio.classList.remove("active");
      if (btnPcAudioIcon) btnPcAudioIcon.textContent = "▶";
      if (btnPcAudioText) btnPcAudioText.textContent = "Start Listening to PC Audio";
    }
  }
}

async function startPcAudioListening() {
  if (isListeningPcAudio) return;
  
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  initPcAudioGraph();
  pcAudioIsFirstChunk = true;
  pcAudioNextTime = 0;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/pc_audio`;
  
  logEvent(`Connecting to PC Audio stream at ${wsUrl}...`, "highlight");
  
  try {
    pcAudioWs = new WebSocket(wsUrl);
    pcAudioWs.binaryType = "arraybuffer";

    pcAudioWs.onopen = () => {
      isListeningPcAudio = true;
      pcAudioIsFirstChunk = true;
      pcAudioNextTime = 0;
      updatePcAudioUI(true);
      logEvent("🎧 Connected! Target PC audio is streaming in high-definition.", "success");
    };

    pcAudioWs.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const meta = JSON.parse(event.data);
          if (meta.type === "stream_info") {
            pcAudioSampleRate = meta.sample_rate || 48000;
            pcAudioChannels = meta.channels || 2;
            if (pcAudioFmtBadge) {
              pcAudioFmtBadge.textContent = `${(pcAudioSampleRate / 1000).toFixed(0)}kHz ${pcAudioChannels === 2 ? 'Stereo' : 'Mono'}`;
            }
          }
        } catch (e) {}
      } else if (event.data instanceof ArrayBuffer && isListeningPcAudio) {
        playPcAudioChunk(event.data);
      }
    };

    pcAudioWs.onclose = () => {
      isListeningPcAudio = false;
      updatePcAudioUI(false);
      logEvent("Target PC Audio stream disconnected.", "warn");
    };

    pcAudioWs.onerror = (e) => {
      logEvent("Target PC Audio stream error. Check if target receiver is running.", "error");
      stopPcAudioListening();
    };
  } catch (err) {
    logEvent(`Could not connect to PC Audio stream: ${err.message}`, "error");
    stopPcAudioListening();
  }
}

function stopPcAudioListening() {
  isListeningPcAudio = false;
  if (pcAudioWs) {
    try { pcAudioWs.close(); } catch(e) {}
    pcAudioWs = null;
  }
  updatePcAudioUI(false);
  logEvent("Stopped listening to Target PC audio.");
}

function togglePcAudioListening() {
  if (isListeningPcAudio) {
    stopPcAudioListening();
  } else {
    startPcAudioListening();
  }
}

function playPcAudioChunk(arrayBuffer) {
  if (!audioContext || !isListeningPcAudio || !pcAudioInputNode) return;

  const int16Array = new Int16Array(arrayBuffer);
  const channels = pcAudioChannels || 2;
  const sampleRate = pcAudioSampleRate || 48000;
  const frameCount = Math.floor(int16Array.length / channels);
  if (frameCount <= 0) return;

  const audioBuf = audioContext.createBuffer(channels, frameCount, sampleRate);

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

  const now = audioContext.currentTime;

  // Ultra-Smooth Jitter Buffer (Mathematically Gapless Playback)
  if (pcAudioIsFirstChunk) {
    pcAudioNextTime = now + pcAudioJitterSec; // 200ms initial cushion on startup
    pcAudioIsFirstChunk = false;
  } else if (now > pcAudioNextTime + 0.150) {
    // True network stall (>150ms of dead silence) -> gently re-cushion
    pcAudioNextTime = now + pcAudioJitterSec;
  } else if (pcAudioNextTime > now + 0.450) {
    // Soft clock-drift cap: if buffer accumulated >450ms from background tab, gently catch up
    pcAudioNextTime = now + 0.250;
  }

  // Gapless, seamless playback:
  // If packet arrived slightly late (<150ms), play immediately at 'now' without void or schedule destruction
  const startAt = Math.max(now, pcAudioNextTime);

  const source = audioContext.createBufferSource();
  source.buffer = audioBuf;
  source.connect(pcAudioInputNode);

  source.start(startAt);
  pcAudioNextTime = startAt + audioBuf.duration;
}

if (btnTogglePcAudio) {
  btnTogglePcAudio.addEventListener("click", togglePcAudioListening);
}

if (pcAudioVolume) {
  pcAudioVolume.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    pcAudioVol = val / 100.0;
    if (pcAudioVolumeVal) pcAudioVolumeVal.textContent = `${val}%`;
    if (pcAudioGain) pcAudioGain.gain.value = pcAudioVol;
  });
}

// Settings Events
function updatePitchLabel(val) {
  const num = parseInt(val);
  if (num === 0) pitchValue.textContent = "0 (Natural)";
  else if (num === 12) pitchValue.textContent = "+12 (Female)";
  else pitchValue.textContent = (num > 0 ? `+${num}` : `${num}`);
}

pitchSlider.addEventListener("input", (e) => {
  updatePitchLabel(e.target.value);
});

pitchSlider.addEventListener("change", (e) => {
  const val = parseInt(e.target.value);
  logEvent(`Pitch shift changed to ${val}`);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: "set_config",
      pitch: val
    }));
  }
});

function updateVoiceGainLabel(val) {
  const num = parseInt(val);
  if (voiceGainValue) {
    if (num === 100) voiceGainValue.textContent = "100% (Normal)";
    else if (num >= 150) voiceGainValue.textContent = `+${num}% (Loud)`;
    else voiceGainValue.textContent = `${num}%`;
  }
}

if (voiceGainSlider) {
  voiceGainSlider.addEventListener("input", (e) => {
    updateVoiceGainLabel(e.target.value);
  });

  voiceGainSlider.addEventListener("change", (e) => {
    const val = parseInt(e.target.value);
    const gainFactor = (val / 100.0).toFixed(2);
    logEvent(`Voice volume boost changed to ${val}% (${gainFactor}x)`);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        action: "set_config",
        volume: parseFloat(gainFactor)
      }));
    }
  });
}

modelSelect.addEventListener("change", (e) => {
  const model = e.target.value;
  logEvent(`Selected model: ${model}`);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: "set_config",
      model: model
    }));
  }
});

algoSelect.addEventListener("change", (e) => {
  const algo = e.target.value;
  logEvent(`Selected algorithm: ${algo}`);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: "set_config",
      algo: algo
    }));
  }
});

// Noise Cancellation Events
function updateDenoiseBadge(mode) {
  if (!denoiseBadge) return;
  if (mode === "high") denoiseBadge.textContent = "Strong Denoise";
  else if (mode === "normal" || mode === "clean") denoiseBadge.textContent = "Clean Voice (Best Quality)";
  else if (mode === "low" || mode === "gentle") denoiseBadge.textContent = "Gentle Filter";
  else if (mode === "off") denoiseBadge.textContent = "Raw Mic (100% Studio Quality)";
}

if (denoiseSelect) {
  denoiseSelect.addEventListener("change", (e) => {
    const val = e.target.value;
    updateDenoiseBadge(val);
    logEvent(`Noise filter set to: ${val}`);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        action: "set_config",
        denoise: val
      }));
    }
  });
}

function updateNoiseGate(val) {
  const num = parseInt(val);
  if (num === 0) {
    gateMode = "off";
    noiseGateThreshold = 0;
    if (noiseGateVal) noiseGateVal.textContent = "Off (0%)";
  } else if (num >= 35 && num <= 65) {
    gateMode = "auto";
    if (noiseGateVal) noiseGateVal.textContent = "Auto-Smart (Fan Adaptive)";
  } else {
    gateMode = "manual";
    // Map slider 1-100 to gentle RMS threshold 0.003 to 0.025
    noiseGateThreshold = 0.003 + (num / 100.0) * 0.022;
    if (noiseGateVal) {
      if (num > 65) noiseGateVal.textContent = `Strict (${num}%)`;
      else noiseGateVal.textContent = `Gentle (${num}%)`;
    }
  }
}

if (noiseGateSlider) {
  noiseGateSlider.addEventListener("input", (e) => {
    updateNoiseGate(e.target.value);
  });
}

// Visualizer Animation
function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);
  if (!canvas || !canvasCtx) return;

  const w = canvas.width || 320;
  const h = canvas.height || 100;
  canvasCtx.clearRect(0, 0, w, h);

  if (!analyser) {
    // Draw gentle glowing idle wave while waiting for mic
    canvasCtx.strokeStyle = "rgba(244, 63, 94, 0.4)";
    canvasCtx.lineWidth = 2;
    canvasCtx.beginPath();
    const cy = h / 2;
    for (let x = 0; x < w; x += 8) {
      canvasCtx.lineTo(x, cy + Math.sin(x * 0.04 + performance.now() * 0.003) * 3);
    }
    canvasCtx.stroke();
    return;
  }

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  const barWidth = (w / bufferLength) * 2.2;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const barHeight = (dataArray[i] / 255) * h * 0.85;

    const gradient = canvasCtx.createLinearGradient(0, h, 0, 0);
    gradient.addColorStop(0, "rgba(244, 63, 94, 0.2)");
    gradient.addColorStop(0.6, "rgba(244, 63, 94, 0.8)");
    gradient.addColorStop(1, "rgba(168, 85, 247, 1)");

    canvasCtx.fillStyle = gradient;
    canvasCtx.fillRect(x, h - barHeight, barWidth, barHeight);

    x += barWidth + 2;
  }
}

// Initialize on page load (handles both early and late script execution)
function initApp() {
  resizeCanvas();
  drawVisualizer();
  connectWebSocket();
  checkExistingPermission();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
