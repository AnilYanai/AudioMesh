/**
 * @file audio-core.js
 * @description Web Audio API pipeline, microphone acquisition, acoustic monitoring,
 *              dynamic noise gating, and hardware profile management (Call vs Music Mode).
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, logEvent } from './state.js';
import { dispatchLiveAudioChunk } from './live-stream.js';

// ==========================================
// 1. AudioContext Lifecycle & Permission
// ==========================================

/**
 * Lazily instantiates and returns the shared Web Audio Context.
 * @returns {AudioContext}
 */
export function getAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return state.audioContext;
}

/**
 * Global unlocker triggered on first user tap/click to satisfy browser autoplay policy.
 */
export function unlockAudioContext() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().then(() => {
      logEvent("AudioContext active and running!", "success");
    }).catch(() => {});
  }
}

/**
 * Checks browser HTTPS security context and queries microphone permission status.
 */
export async function checkExistingPermission() {
  logEvent("Checking browser environment and security context...");

  // 1. Insecure Context check (mobile Chrome requires HTTPS for microphone)
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!window.isSecureContext && window.location.protocol === "http:" && !isLocalhost) {
    logEvent("Insecure HTTP detected. Mobile browsers block microphone on HTTP!", "error");
    if (elements.micPromptBanner) elements.micPromptBanner.classList.remove("ready");
    if (elements.micBannerTitle) elements.micBannerTitle.textContent = "🔒 HTTPS Required for Microphone";
    if (elements.micBannerSub) elements.micBannerSub.textContent = "Mobile Chrome blocks mic on plain HTTP. Tap to switch to HTTPS";
    if (elements.enableMicBtn) {
      elements.enableMicBtn.textContent = "Switch to HTTPS";
      elements.enableMicBtn.onclick = () => {
        window.location.href = `https://${window.location.hostname}:${window.location.port || 8000}`;
      };
    }
    if (elements.audioStateTag) elements.audioStateTag.textContent = "Switch to HTTPS";
    return;
  }

  // 2. Query Permissions API if available
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
        if (elements.micPromptBanner) elements.micPromptBanner.classList.remove("ready");
        if (elements.micBannerTitle) elements.micBannerTitle.textContent = "Microphone Blocked in Settings";
        if (elements.micBannerSub) elements.micBannerSub.textContent = "Tap 🔒 in browser address bar and enable Microphone";
        if (elements.enableMicBtn) {
          elements.enableMicBtn.textContent = "Blocked";
          elements.enableMicBtn.disabled = true;
        }
        if (elements.audioStateTag) elements.audioStateTag.textContent = "Mic Blocked";
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

  // Bind manual activation handlers
  if (elements.enableMicBtn) elements.enableMicBtn.onclick = () => enableMicrophone(false);
  if (elements.micPromptBanner) elements.micPromptBanner.onclick = () => enableMicrophone(false);
}

// ==========================================
// 2. Microphone Stream & Web Audio Graph
// ==========================================

/**
 * Requests audio input stream from the browser, builds the DSP analysis graph,
 * and attaches the real-time processing worker.
 *
 * @param {boolean} [isAuto=false] - Whether triggered automatically on page load.
 * @param {boolean} [forceReacquire=false] - Whether to destroy existing stream and reacquire.
 * @returns {Promise<boolean>} Success status.
 */
export async function enableMicrophone(isAuto = false, forceReacquire = false) {
  if (state.micReady && state.mediaStream && !forceReacquire) {
    return true;
  }

  if (forceReacquire && state.mediaStream) {
    try {
      state.mediaStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    state.mediaStream = null;
    state.micReady = false;
  }

  logEvent(`Activating audio stream (auto=${isAuto}, force=${forceReacquire})...`);

  const ctx = getAudioContext();
  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
      logEvent("AudioContext resumed.", "highlight");
    }
  } catch (e) {
    logEvent(`AudioContext init note: ${e.message}`, "warn");
  }

  const getMedia = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    ? (constraints) => navigator.mediaDevices.getUserMedia(constraints)
    : (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia);

  if (!getMedia) {
    logEvent("navigator.mediaDevices.getUserMedia is unavailable on this origin!", "error");
    if (elements.micPromptBanner) elements.micPromptBanner.classList.remove("ready");
    if (elements.micBannerTitle) elements.micBannerTitle.textContent = "Microphone API Unavailable";
    if (elements.micBannerSub) elements.micBannerSub.textContent = "Please use HTTPS (https://" + window.location.host + ")";
    if (elements.enableMicBtn) {
      elements.enableMicBtn.textContent = "Open HTTPS";
      elements.enableMicBtn.onclick = () => {
        window.location.href = `https://${window.location.hostname}:${window.location.port || 8000}`;
      };
    }
    return false;
  }

  try {
    if (!isAuto && !forceReacquire) {
      if (elements.micBannerTitle) elements.micBannerTitle.textContent = "Requesting Permission...";
      if (elements.micBannerSub) elements.micBannerSub.textContent = "Please tap 'Allow' on the popup";
    }

    const isCall = (state.globalAudioMode === "call");
    logEvent(`Requesting getUserMedia (${isCall ? '📞 Call Mode: Echo Cancellation & Earpiece' : '🎵 Music Mode: Pure Stereo'})...`);

    // In Call Mode: echoCancellation & noiseSuppression = true triggers Android VOICE_COMMUNICATION HAL.
    // In Music Mode: false keeps Android in full-fidelity Media Volume without ducking.
    state.mediaStream = await getMedia.call(navigator.mediaDevices || navigator, {
      audio: {
        echoCancellation: isCall,
        noiseSuppression: isCall,
        autoGainControl: false, // Disables AGC to prevent mobile browser from boosting fan noise in silence
      }
    });

    logEvent(`Microphone stream acquired! Tracks: ${state.mediaStream.getAudioTracks().length}`, "success");

    state.analyser = ctx.createAnalyser();
    state.analyser.fftSize = 256;
    state.analyser.smoothingTimeConstant = 0.4;

    const source = ctx.createMediaStreamSource(state.mediaStream);
    // Connect directly to analyser so the visualizer mirrors live speech
    source.connect(state.analyser);

    // 1. Hardware/WebAudio 75Hz High-Pass Filter (cuts mechanical desk thumps & fan rumble)
    const micHighpass = ctx.createBiquadFilter();
    micHighpass.type = "highpass";
    micHighpass.frequency.value = 75;
    source.connect(micHighpass);

    // 2. ScriptProcessor for continuous PCM chunking
    state.scriptProcessor = ctx.createScriptProcessor(4096, 1, 1);
    micHighpass.connect(state.scriptProcessor);

    // 3. Terminate ScriptProcessor into a zero-gain node so the browser does NOT route
    // mic audio physically to phone speakers (which would create local feedback)
    const micMuteNode = ctx.createGain();
    micMuteNode.gain.value = 0.0;
    state.scriptProcessor.connect(micMuteNode);
    micMuteNode.connect(ctx.destination);

    // Store in global window scope so V8 garbage collector NEVER purges active nodes
    window._audioGraphNodes = { source, micHighpass, scriptProcessor: state.scriptProcessor, analyser: state.analyser, mediaStream: state.mediaStream, micMuteNode };

    state.scriptProcessor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const resampled = resampleAudio(input, ctx.sampleRate, 16000);

      // Ensure output buffer is zeroed out to prevent speaker bleed
      const output = e.outputBuffer.getChannelData(0);
      output.fill(0);

      // --- Acoustic RMS Tracking ---
      let sumSq = 0;
      for (let i = 0; i < resampled.length; i++) {
        sumSq += resampled[i] * resampled[i];
      }
      const currentRms = Math.sqrt(sumSq / resampled.length);

      if (state.isCalibratingRoom) {
        state.calibrationRmsSamples.push(currentRms);
      }

      // Voice Activity Detection (VAD)
      const vadThresholdRatio = (state.vocalProfile === "creator") ? 1.25 : 1.7;
      const isSpeaking = currentRms > (state.ambientNoiseFloor * vadThresholdRatio);

      // Noise Floor Tracking with VAD Freeze:
      // Never update the noise floor during active speech to avoid vocal attenuation over long sentences.
      if (!isSpeaking) {
        if (currentRms < state.ambientNoiseFloor) {
          state.ambientNoiseFloor = state.ambientNoiseFloor * 0.85 + currentRms * 0.15;
        } else {
          state.ambientNoiseFloor = state.ambientNoiseFloor * 0.998 + currentRms * 0.002;
        }
      }

      if (isSpeaking) {
        state.speechPeakLevel = state.speechPeakLevel * 0.9 + currentRms * 0.1;
      } else {
        state.speechPeakLevel = state.speechPeakLevel * 0.995;
      }

      // Dynamic gate threshold calculation
      if (state.vocalProfile === "creator") {
        state.autoDynamicGateThreshold = state.ambientNoiseFloor * 1.12;
      } else {
        state.autoDynamicGateThreshold = state.ambientNoiseFloor * 1.40;
      }

      const effectiveThreshold = (state.gateMode === "auto") ? state.autoDynamicGateThreshold : state.noiseGateThreshold;

      // Intelligent Client Noise Gate
      if (effectiveThreshold > 0) {
        let targetGateGain = 1.0;
        const requiredHangover = (state.vocalProfile === "creator") ? 18 : 12; // 450ms / 300ms
        const softFloor = (state.vocalProfile === "creator") ? 0.45 : 0.35;

        if (currentRms >= effectiveThreshold) {
          state.gateHangoverFrames = requiredHangover;
          targetGateGain = 1.0;
        } else if (state.gateHangoverFrames > 0) {
          state.gateHangoverFrames--;
          targetGateGain = 1.0;
        } else {
          targetGateGain = softFloor;
        }

        // Smooth gain slewing to eliminate clicks
        for (let i = 0; i < resampled.length; i++) {
          state.gateGain += (targetGateGain - state.gateGain) * 0.05;
          resampled[i] *= state.gateGain;
        }
      }

      // Update UI Acoustic Monitor every ~250ms
      const now = performance.now();
      if (now - state.lastAcousticUiUpdate > 250) {
        state.lastAcousticUiUpdate = now;
        const noiseDb = Math.round(20 * Math.log10(Math.max(state.ambientNoiseFloor, 1e-4)));
        const voiceDb = Math.round(20 * Math.log10(Math.max(state.speechPeakLevel, 1e-4)));
        const snrDb = Math.max(0, voiceDb - noiseDb);

        if (elements.statNoiseFloor) elements.statNoiseFloor.textContent = `${noiseDb} dB`;
        if (elements.statVoiceLevel) elements.statVoiceLevel.textContent = isSpeaking ? `${voiceDb} dB` : "Idle";
        if (elements.statSnrQuality) {
          if (snrDb >= 16) {
            elements.statSnrQuality.textContent = `+${snrDb} dB (Clear ✓)`;
            elements.statSnrQuality.className = "acoustic-val snr-badge-optimal";
          } else if (snrDb >= 8) {
            elements.statSnrQuality.textContent = `+${snrDb} dB (Good)`;
            elements.statSnrQuality.className = "acoustic-val snr-badge-good";
          } else {
            elements.statSnrQuality.textContent = isSpeaking ? `+${snrDb} dB (Speak Closer)` : "Calibrated ✓";
            elements.statSnrQuality.className = "acoustic-val snr-badge-low";
          }
        }
      }

      // Buffer audio according to current mode
      if (state.isRecordingPtt) {
        state.pttAudioBuffer.push(...resampled);
      } else if (state.isLiveStreaming) {
        state.liveAudioBuffer.push(...resampled);
        const targetSamples = Math.round((state.liveChunkInterval || 1.5) * 16000);
        if (state.liveAudioBuffer.length >= targetSamples) {
          dispatchLiveAudioChunk();
        }
      }
    };

    state.micReady = true;
    if (elements.micPromptBanner) elements.micPromptBanner.classList.add("ready");
    if (elements.micBannerTitle) elements.micBannerTitle.textContent = "Microphone Active ✓";
    if (elements.micBannerSub) elements.micBannerSub.textContent = "Tap 'Mute Mic' anytime to switch to pure Media Mode";
    if (elements.enableMicBtn) {
      elements.enableMicBtn.textContent = "Mute Mic";
      elements.enableMicBtn.disabled = false;
      elements.enableMicBtn.onclick = toggleMicMute;
    }
    if (elements.audioStateTag) elements.audioStateTag.textContent = "Microphone Ready";

    logEvent("Microphone pipeline active and hot! Ready to talk.", "success");
    return true;
  } catch (err) {
    logEvent(`getUserMedia error: ${err.name} - ${err.message}`, "error");
    if (elements.micPromptBanner) elements.micPromptBanner.classList.remove("ready");
    if (elements.micBannerTitle) {
      elements.micBannerTitle.textContent = (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
        ? "Microphone Permission Denied"
        : "Microphone Error";
    }
    if (elements.micBannerSub) {
      elements.micBannerSub.textContent = err.message || "Could not access microphone";
    }
    if (elements.enableMicBtn) {
      elements.enableMicBtn.textContent = "Retry";
      elements.enableMicBtn.disabled = false;
    }
    if (elements.audioStateTag) elements.audioStateTag.textContent = "Permission Required";
    return false;
  }
}

// ==========================================
// 3. Microphone Standby & Mutex Controls
// ==========================================

export function toggleMicMute() {
  setMicMuted(!state.isMicMuted);
}

export function setMicMuted(muted) {
  if (!state.micReady || !state.mediaStream) return;
  state.isMicMuted = muted;
  state.mediaStream.getAudioTracks().forEach(track => {
    track.enabled = !muted;
  });
  if (elements.enableMicBtn) {
    elements.enableMicBtn.textContent = muted ? "Unmute Mic" : "Mute Mic";
  }
  if (elements.micBannerTitle) {
    elements.micBannerTitle.textContent = muted ? "Microphone on Standby 🔇" : "Microphone Active ✓";
  }
  if (elements.micBannerSub) {
    elements.micBannerSub.textContent = muted ? "Tap 'Unmute Mic' to talk anytime" : "Tap 'Mute Mic' anytime to switch to pure Media Mode";
  }
  if (elements.audioStateTag) {
    elements.audioStateTag.textContent = muted ? "Mic Standby" : "Microphone Ready";
  }
  logEvent(muted ? "🔇 Microphone on standby (phone returns to Media Volume)." : "🎙️ Microphone unmuted and active.", "highlight");
}

export function stopMicrophone() {
  if (state.mediaStream) {
    try {
      state.mediaStream.getTracks().forEach(track => {
        track.stop(); // Releases Android AudioRecord thread and drops In-Call mode
      });
    } catch (e) {}
    state.mediaStream = null;
  }
  state.micReady = false;

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

  if (elements.micPromptBanner) elements.micPromptBanner.classList.remove("ready");
  if (elements.micBannerTitle) elements.micBannerTitle.textContent = "Microphone on Standby 🔇";
  if (elements.micBannerSub) elements.micBannerSub.textContent = "Tap to enable microphone";
  if (elements.enableMicBtn) {
    elements.enableMicBtn.textContent = "Activate Mic";
    elements.enableMicBtn.disabled = false;
    elements.enableMicBtn.onclick = () => enableMicrophone(false, true);
  }
  if (elements.audioStateTag) elements.audioStateTag.textContent = "Mic Standby";
}

// ==========================================
// 4. Global Audio Profile Management
// ==========================================

export async function setGlobalAudioMode(mode, relinkCallback = null) {
  if (mode !== "call" && mode !== "music") return;
  state.globalAudioMode = mode;

  if (elements.btnGlobalCallMode) elements.btnGlobalCallMode.classList.toggle("active", mode === "call");
  if (elements.btnGlobalMusicMode) elements.btnGlobalMusicMode.classList.toggle("active", mode === "music");

  if (elements.globalModeBadge) {
    if (mode === "call") {
      elements.globalModeBadge.textContent = "📞 Call Mode (AEC & Earpiece)";
      elements.globalModeBadge.className = "global-mode-pill call";
    } else {
      elements.globalModeBadge.textContent = "🎵 Music Mode (Hi-Fi & Media Vol)";
      elements.globalModeBadge.className = "global-mode-pill music";
    }
  }

  if (typeof relinkCallback === "function") {
    relinkCallback();
  }

  if (mode === "music") {
    // 🎵 In Music Mode: Stop the microphone completely to force Android into MEDIA VOLUME
    stopMicrophone();
    logEvent("🎵 Switched to Music Mode! Phone volume buttons switched to MEDIA VOLUME. Full 48kHz stereo active (Zero AEC).", "success");
  } else {
    // 📞 In Call Mode: Re-acquire microphone with echoCancellation: true
    stopMicrophone();
    await enableMicrophone(true, true);
    logEvent("📞 Switched to Call Mode! Phone Ear Speaker & hardware Echo Cancellation (AEC) active for private calls.", "success");
  }
}

// ==========================================
// 5. Digital Signal Conversion Helpers
// ==========================================

/**
 * Linear interpolation audio resampler.
 */
export function resampleAudio(audio, origSr, targetSr) {
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

/**
 * Converts Float32Array [-1.0, 1.0] to 16-bit signed PCM ArrayBuffer.
 */
export function floatTo16BitPCM(floatArray) {
  const buffer = new ArrayBuffer(floatArray.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < floatArray.length; i++) {
    let s = Math.max(-1, Math.min(1, floatArray[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}
