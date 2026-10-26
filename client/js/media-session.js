/**
 * @file media-session.js
 * @description Hardware headphone remote integration (Play/Pause, Next Track, Prev Track)
 *              via Web Media Session API, HTMLMediaElement audio keeper, and Target PC control.
 *              Includes hardware debouncing, mutual event synchronization, and lock-screen controls.
 * @author Mathavan & Antigravity
 * @version 20261026_full_fix_v26
 */

import { state, elements, logEvent } from './state.js';

let mediaPollTimer = null;
let lastActionTimestamp = 0;
const HARDWARE_DEBOUNCE_MS = 450;

/**
 * Checks if a hardware/gesture event should be debounced to prevent duplicate triggers
 * caused by Android Chrome firing MediaSession, AudioElement onpause, and KeyEvents simultaneously.
 * @returns {boolean} True if event should be discarded
 */
function isDebounced() {
  const now = Date.now();
  if (now - lastActionTimestamp < HARDWARE_DEBOUNCE_MS) {
    return true;
  }
  lastActionTimestamp = now;
  return false;
}

/**
 * Returns the hidden media keeper audio element in the DOM.
 * @returns {HTMLAudioElement|null}
 */
export function getMediaSessionKeeper() {
  return document.getElementById("mediaSessionKeeper");
}

/**
 * Synchronously invoked directly inside user gesture (e.g. tap/click on 'Start Listening').
 * This satisfies mobile browser autoplay policy (Android Chrome & iOS Safari)
 * and grants Audio Focus so the phone OS routes headphone button events to this page.
 */
export function unlockMediaSessionOnUserGesture() {
  const audio = getMediaSessionKeeper();
  if (audio) {
    audio.muted = false;
    audio.volume = 1.0;
    audio.play().then(() => {
      logEvent("🎧 Headphone Remote & Lock Screen active!", "success");
    }).catch((err) => {
      logEvent(`Headphone remote unlock notice: ${err.message}`, "warn");
    });
  }

  setupMediaSessionHandlers();
  attachAudioKeeperListeners();
  attachHardwareKeyListeners();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = "playing";
  }
}

/**
 * Activates streaming state and starts periodic polling of track info.
 */
export async function activateMediaSession() {
  const audio = getMediaSessionKeeper();
  if (audio && audio.paused) {
    try {
      audio.muted = false;
      audio.volume = 1.0;
      await audio.play();
    } catch (e) {}
  }

  setupMediaSessionHandlers();
  attachAudioKeeperListeners();
  attachHardwareKeyListeners();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = "playing";
  }

  startMediaPolling();
  refreshMediaInfo();
}

/**
 * Pauses keeper and releases session when PC audio listening stops.
 */
export function deactivateMediaSession() {
  stopMediaPolling();
  const audio = getMediaSessionKeeper();
  if (audio && !audio.paused) {
    try {
      state.pcMedia.internalAction = true;
      audio.pause();
      setTimeout(() => { state.pcMedia.internalAction = false; }, 300);
    } catch (e) {}
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = "none";
  }
}

/**
 * Triggers an explicit PAUSE action from hardware headphone or on-screen UI.
 * Keeps keeper audio element and MediaSession in strict synchronization.
 * @param {boolean} [skipDebounce=false]
 */
export async function triggerMediaPause(skipDebounce = false) {
  if (!skipDebounce && isDebounced()) return;
  logEvent("🎧 [Media Remote]: Pause", "highlight");

  // Keep keeper audio element in sync (Android uses its state for lock screen UI)
  const audio = getMediaSessionKeeper();
  if (audio && !audio.paused) {
    try {
      state.pcMedia.internalAction = true;
      audio.pause();
      setTimeout(() => { state.pcMedia.internalAction = false; }, 300);
    } catch (e) {}
  }

  // Update UI and playbackState optimistically
  state.pcMedia.status = "paused";
  if (elements.btnMediaPlayPause) {
    elements.btnMediaPlayPause.textContent = "▶";
    elements.btnMediaPlayPause.title = "Play (Single-Tap Earphone)";
  }
  if (elements.mediaStatusBadge) {
    elements.mediaStatusBadge.textContent = "PAUSED";
    elements.mediaStatusBadge.style.background = "rgba(100,116,139,0.2)";
    elements.mediaStatusBadge.style.color = "#94a3b8";
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = "paused";
  }

  await sendMediaControl("pause");
}

/**
 * Triggers an explicit PLAY / RESUME action from hardware headphone or on-screen UI.
 * @param {boolean} [skipDebounce=false]
 */
export async function triggerMediaPlay(skipDebounce = false) {
  if (!skipDebounce && isDebounced()) return;
  logEvent("🎧 [Media Remote]: Play / Resume", "highlight");

  const audio = getMediaSessionKeeper();
  if (audio && audio.paused) {
    try {
      state.pcMedia.internalAction = true;
      await audio.play();
      setTimeout(() => { state.pcMedia.internalAction = false; }, 300);
    } catch (e) {}
  }

  state.pcMedia.status = "playing";
  if (elements.btnMediaPlayPause) {
    elements.btnMediaPlayPause.textContent = "⏸";
    elements.btnMediaPlayPause.title = "Pause (Single-Tap Earphone)";
  }
  if (elements.mediaStatusBadge) {
    elements.mediaStatusBadge.textContent = "PLAYING";
    elements.mediaStatusBadge.style.background = "rgba(16,185,129,0.2)";
    elements.mediaStatusBadge.style.color = "#34d399";
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = "playing";
  }

  await sendMediaControl("play");
}

/**
 * Toggles playback (Play <=> Pause) based on current state.
 * @param {boolean} [skipDebounce=false]
 */
export async function triggerMediaToggle(skipDebounce = false) {
  if (!skipDebounce && isDebounced()) return;
  const isCurrentlyPlaying = state.pcMedia.status === "playing";
  if (isCurrentlyPlaying) {
    await triggerMediaPause(true);
  } else {
    await triggerMediaPlay(true);
  }
}

/**
 * Triggers NEXT TRACK from headphone double-click or web UI.
 * @param {boolean} [skipDebounce=false]
 */
export async function triggerMediaNext(skipDebounce = false) {
  if (!skipDebounce && isDebounced()) return;
  logEvent("🎧 [Media Remote]: Next Track (Double-Tap)", "highlight");
  await sendMediaControl("next");
}

/**
 * Triggers PREVIOUS TRACK from headphone triple-click or web UI.
 * @param {boolean} [skipDebounce=false]
 */
export async function triggerMediaPrev(skipDebounce = false) {
  if (!skipDebounce && isDebounced()) return;
  logEvent("🎧 [Media Remote]: Previous Track (Triple-Tap)", "highlight");
  await sendMediaControl("previous");
}

/**
 * Attaches direct event listeners to the <audio> element.
 * On some Android phones, pressing the earphone pause button directly pauses the
 * audio element rather than routing through MediaSession.
 */
export function attachAudioKeeperListeners() {
  const audio = getMediaSessionKeeper();
  if (!audio || audio._hasKeeperListeners) return;
  audio._hasKeeperListeners = true;

  // When OS / Headphone sends hardware pause event to the audio element
  audio.addEventListener("pause", () => {
    if (state.pcMedia.internalAction) return;
    triggerMediaPause();
  });

  // When OS / Headphone sends hardware play event to the audio element
  audio.addEventListener("play", () => {
    if (state.pcMedia.internalAction) return;
    triggerMediaPlay();
  });
}

/**
 * Attaches global keydown listeners for hardware media keys (MediaPlayPause, Next, Prev)
 * sent by wired and Bluetooth headphones on Android and desktop browsers.
 */
export function attachHardwareKeyListeners() {
  if (window._hasHardwareKeyListeners) return;
  window._hasHardwareKeyListeners = true;

  const handleKey = (e) => {
    const key = e.key || e.code || "";
    const code = e.keyCode || e.which || 0;

    if (key === "MediaPlayPause" || code === 179) {
      e.preventDefault();
      triggerMediaToggle();
    } else if (key === "MediaPlay") {
      e.preventDefault();
      triggerMediaPlay();
    } else if (key === "MediaPause") {
      e.preventDefault();
      triggerMediaPause();
    } else if (key === "MediaTrackNext" || code === 176) {
      e.preventDefault();
      triggerMediaNext();
    } else if (key === "MediaTrackPrevious" || code === 177) {
      e.preventDefault();
      triggerMediaPrev();
    } else if (key === "MediaStop" || code === 178) {
      e.preventDefault();
      triggerMediaPause();
    }
  };

  window.addEventListener("keydown", handleKey, { capture: true });
  document.addEventListener("keydown", handleKey, { capture: true });
}

/**
 * Registers Web MediaSession API action handlers for headphone buttons and lock screen.
 */
export function setupMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;

  updateMediaSessionMetadata(state.pcMedia.title, state.pcMedia.artist);

  // Single-Click Earphone Button (Pause)
  try {
    navigator.mediaSession.setActionHandler("pause", triggerMediaPause);
  } catch (e) {}

  // Single-Click Earphone Button (Play / Resume)
  try {
    navigator.mediaSession.setActionHandler("play", triggerMediaPlay);
  } catch (e) {}

  // Stop button
  try {
    navigator.mediaSession.setActionHandler("stop", triggerMediaPause);
  } catch (e) {}

  // Double-Click Earphone Button (Next Track)
  try {
    navigator.mediaSession.setActionHandler("nexttrack", triggerMediaNext);
  } catch (e) {}

  // Triple-Click Earphone Button (Previous Track)
  try {
    navigator.mediaSession.setActionHandler("previoustrack", triggerMediaPrev);
  } catch (e) {}

  // Bluetooth seek buttons
  try {
    navigator.mediaSession.setActionHandler("seekforward", triggerMediaNext);
  } catch (e) {}
  try {
    navigator.mediaSession.setActionHandler("seekbackward", triggerMediaPrev);
  } catch (e) {}
}

/**
 * Updates browser lock-screen and notification metadata.
 */
export function updateMediaSessionMetadata(title, artist) {
  if (!('mediaSession' in navigator)) return;

  try {
    const origin = window.location.origin;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || "Target PC Audio",
      artist: artist || "VoiceMorph Wireless",
      album: "PC Media Stream",
      artwork: [
        { src: origin + "/icon-96.png", sizes: "96x96", type: "image/png" },
        { src: origin + "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: origin + "/icon-512.png", sizes: "512x512", type: "image/png" }
      ]
    });
  } catch (e) {}
}

/**
 * Sends media control command to the server and Target PC.
 */
export async function sendMediaControl(action) {
  try {
    const res = await fetch("/api/media/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (data && data.info) {
      updateMediaUI(data.info);
    } else {
      setTimeout(refreshMediaInfo, 300);
    }
  } catch (err) {
    logEvent(`Media command error: ${err.message}`, "warn");
  }
}

/**
 * Fetches active track title, artist, and playback status from Target PC.
 */
export async function refreshMediaInfo() {
  try {
    const res = await fetch("/api/media/info");
    if (!res.ok) return;
    const info = await res.json();
    updateMediaUI(info);
  } catch (err) {}
}

/**
 * Updates UI DOM elements, keeper audio element, and MediaSession playback status.
 */
export function updateMediaUI(info) {
  if (!info) return;

  state.pcMedia.title = info.title || "PC Audio";
  state.pcMedia.artist = info.artist || "Target PC";
  state.pcMedia.status = (info.status || "stopped").toLowerCase();

  const isPlaying = state.pcMedia.status === "playing";

  if (elements.mediaTrackTitle) {
    elements.mediaTrackTitle.textContent = state.pcMedia.title;
    elements.mediaTrackTitle.title = state.pcMedia.title;
  }
  if (elements.mediaTrackArtist) {
    elements.mediaTrackArtist.textContent = state.pcMedia.artist;
  }
  if (elements.mediaStatusBadge) {
    elements.mediaStatusBadge.textContent = isPlaying ? "PLAYING" : (state.pcMedia.status === "paused" ? "PAUSED" : "READY");
    elements.mediaStatusBadge.style.background = isPlaying ? "rgba(16,185,129,0.2)" : "rgba(100,116,139,0.2)";
    elements.mediaStatusBadge.style.color = isPlaying ? "#34d399" : "#94a3b8";
  }
  if (elements.btnMediaPlayPause) {
    elements.btnMediaPlayPause.textContent = isPlaying ? "⏸" : "▶";
    elements.btnMediaPlayPause.title = isPlaying ? "Pause (Single-Tap Earphone)" : "Play (Single-Tap Earphone)";
  }

  // Sync keeper audio element with Target PC playback status
  const audio = getMediaSessionKeeper();
  if (audio && !state.pcMedia.internalAction) {
    if (isPlaying && audio.paused && state.pcAudio.isListening) {
      state.pcMedia.internalAction = true;
      audio.play().catch(() => {}).finally(() => { state.pcMedia.internalAction = false; });
    } else if (!isPlaying && !audio.paused) {
      state.pcMedia.internalAction = true;
      audio.pause();
      state.pcMedia.internalAction = false;
    }
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    updateMediaSessionMetadata(state.pcMedia.title, state.pcMedia.artist);
  }
}

/**
 * Polls media status periodically while PC audio listening is active.
 */
export function startMediaPolling() {
  stopMediaPolling();
  mediaPollTimer = setInterval(refreshMediaInfo, 2500);
}

export function stopMediaPolling() {
  if (mediaPollTimer) {
    clearInterval(mediaPollTimer);
    mediaPollTimer = null;
  }
}

/**
 * Attaches click event listeners to UI media buttons.
 */
export function initMediaControls() {
  if (elements.btnMediaPlayPause) {
    elements.btnMediaPlayPause.addEventListener("click", (e) => {
      e.preventDefault();
      triggerMediaToggle();
    });
  }

  if (elements.btnMediaNext) {
    elements.btnMediaNext.addEventListener("click", (e) => {
      e.preventDefault();
      triggerMediaNext();
    });
  }

  if (elements.btnMediaPrev) {
    elements.btnMediaPrev.addEventListener("click", (e) => {
      e.preventDefault();
      triggerMediaPrev();
    });
  }

  attachAudioKeeperListeners();
  attachHardwareKeyListeners();

  // Initial fetch of media info
  refreshMediaInfo();
}
