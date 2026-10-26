/**
 * @file media-session.js
 * @description Hardware headphone remote integration (Play/Pause, Next Track, Prev Track)
 *              via Web Media Session API, HTMLMediaElement audio keeper, and Target PC control.
 * @author Mathavan & Antigravity
 * @version 20261026_media_v25
 */

import { state, elements, logEvent } from './state.js';

let mediaPollTimer = null;

/**
 * Returns the hidden media keeper audio element in the DOM.
 * @returns {HTMLAudioElement|null}
 */
export function getMediaSessionKeeper() {
  return document.getElementById("mediaSessionKeeper");
}

/**
 * Synchronously invoked directly inside user gesture (e.g. tap/click on 'Start Listening').
 * This satisfies the strict mobile browser autoplay policy (Android Chrome & iOS Safari)
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
 * Attaches direct event listeners to the <audio> element.
 * On many Android versions, clicking the headphone pause button directly invokes
 * pause() on the active media element rather than going through MediaSession.
 */
export function attachAudioKeeperListeners() {
  const audio = getMediaSessionKeeper();
  if (!audio || audio._hasKeeperListeners) return;
  audio._hasKeeperListeners = true;

  // When OS / Headphone sends hardware pause event to the audio element
  audio.addEventListener("pause", () => {
    if (state.pcMedia.internalAction) return;
    logEvent("🎧 [Headphone Button]: Pause triggered via audio element", "highlight");
    sendMediaControl("play_pause");
  });

  // When OS / Headphone sends hardware play event to the audio element
  audio.addEventListener("play", () => {
    if (state.pcMedia.internalAction) return;
    logEvent("🎧 [Headphone Button]: Play triggered via audio element", "highlight");
    sendMediaControl("play_pause");
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
      logEvent("🎧 [Headphone Keydown]: MediaPlayPause", "highlight");
      sendMediaControl("play_pause");
    } else if (key === "MediaTrackNext" || code === 176) {
      e.preventDefault();
      logEvent("🎧 [Headphone Keydown]: MediaTrackNext", "highlight");
      sendMediaControl("next");
    } else if (key === "MediaTrackPrevious" || code === 177) {
      e.preventDefault();
      logEvent("🎧 [Headphone Keydown]: MediaTrackPrevious", "highlight");
      sendMediaControl("previous");
    } else if (key === "MediaStop" || code === 178) {
      e.preventDefault();
      logEvent("🎧 [Headphone Keydown]: MediaStop", "highlight");
      sendMediaControl("play_pause");
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

  // Single-Click Earphone Button (Play / Pause / Resume)
  try {
    navigator.mediaSession.setActionHandler("pause", async () => {
      logEvent("🎧 [Headphone MediaSession]: Pause / Toggle", "highlight");
      await sendMediaControl("play_pause");
    });
  } catch (e) {}

  try {
    navigator.mediaSession.setActionHandler("play", async () => {
      logEvent("🎧 [Headphone MediaSession]: Play / Resume", "highlight");
      const audio = getMediaSessionKeeper();
      if (audio && audio.paused) {
        try {
          state.pcMedia.internalAction = true;
          await audio.play();
          setTimeout(() => { state.pcMedia.internalAction = false; }, 300);
        } catch (e) {}
      }
      await sendMediaControl("play_pause");
    });
  } catch (e) {}

  try {
    navigator.mediaSession.setActionHandler("stop", async () => {
      logEvent("🎧 [Headphone MediaSession]: Stop / Toggle", "highlight");
      await sendMediaControl("play_pause");
    });
  } catch (e) {}

  // Double-Click Earphone Button (Next Track)
  try {
    navigator.mediaSession.setActionHandler("nexttrack", async () => {
      logEvent("🎧 [Headphone MediaSession]: Next Song (Double-Tap)", "highlight");
      await sendMediaControl("next");
    });
  } catch (e) {}

  // Triple-Click Earphone Button (Previous Track)
  try {
    navigator.mediaSession.setActionHandler("previoustrack", async () => {
      logEvent("🎧 [Headphone MediaSession]: Previous Song (Triple-Tap)", "highlight");
      await sendMediaControl("previous");
    });
  } catch (e) {}

  // Bluetooth remotes that send seekforward / seekbackward on hold
  try {
    navigator.mediaSession.setActionHandler("seekforward", async () => {
      logEvent("🎧 [Headphone MediaSession]: Seek Forward / Next", "highlight");
      await sendMediaControl("next");
    });
  } catch (e) {}

  try {
    navigator.mediaSession.setActionHandler("seekbackward", async () => {
      logEvent("🎧 [Headphone MediaSession]: Seek Backward / Prev", "highlight");
      await sendMediaControl("previous");
    });
  } catch (e) {}
}

/**
 * Updates browser lock-screen and notification metadata.
 */
export function updateMediaSessionMetadata(title, artist) {
  if (!('mediaSession' in navigator)) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || "Target PC Audio",
      artist: artist || "VoiceMorph Wireless",
      album: "PC Media Stream",
      artwork: [
        { src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%236366f1'/%3E%3Ctext x='50' y='65' font-size='45' text-anchor='middle' fill='white'%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E", sizes: "96x96", type: "image/svg+xml" }
      ]
    });
  } catch (e) {}
}

/**
 * Sends media control command to the server and Target PC.
 */
export async function sendMediaControl(action) {
  try {
    // Provide instant optimistic UI feedback
    if (elements.btnMediaPlayPause && (action === "play_pause" || action === "play" || action === "pause")) {
      const isCurrentlyPlaying = state.pcMedia.status === "playing";
      elements.btnMediaPlayPause.textContent = isCurrentlyPlaying ? "▶" : "⏸";
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isCurrentlyPlaying ? "paused" : "playing";
      }
    }

    const res = await fetch("/api/media/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (data.info) {
      updateMediaUI(data.info);
    } else {
      setTimeout(refreshMediaInfo, 400);
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
 * Updates UI DOM elements and MediaSession playback status.
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
    elements.btnMediaPlayPause.addEventListener("click", () => {
      unlockMediaSessionOnUserGesture();
      sendMediaControl("play_pause");
    });
  }

  if (elements.btnMediaNext) {
    elements.btnMediaNext.addEventListener("click", () => {
      unlockMediaSessionOnUserGesture();
      sendMediaControl("next");
    });
  }

  if (elements.btnMediaPrev) {
    elements.btnMediaPrev.addEventListener("click", () => {
      unlockMediaSessionOnUserGesture();
      sendMediaControl("previous");
    });
  }

  attachAudioKeeperListeners();
  attachHardwareKeyListeners();

  // Initial fetch of media info
  refreshMediaInfo();
}
