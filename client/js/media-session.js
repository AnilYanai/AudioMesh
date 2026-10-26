/**
 * @file media-session.js
 * @description Hardware headphone remote integration (Play/Pause, Next Track, Prev Track)
 *              via Web Media Session API and Target PC media player control.
 * @author Mathavan & Antigravity
 * @version 20261026_media_v24
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
    audio.play().then(() => {
      logEvent("🎧 Headphone Remote & Lock Screen active!", "success");
    }).catch((err) => {
      logEvent(`Headphone remote unlock notice: ${err.message}`, "warn");
    });
  }

  setupMediaSessionHandlers();

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
      await audio.play();
    } catch (e) {}
  }

  setupMediaSessionHandlers();

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
      audio.pause();
    } catch (e) {}
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = "none";
  }
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
      logEvent("🎧 [Headphone]: Pause / Toggle", "highlight");
      await sendMediaControl("play_pause");
    });
  } catch (e) {}

  try {
    navigator.mediaSession.setActionHandler("play", async () => {
      logEvent("🎧 [Headphone]: Play / Resume", "highlight");
      const audio = getMediaSessionKeeper();
      if (audio && audio.paused) {
        try { await audio.play(); } catch(e) {}
      }
      await sendMediaControl("play_pause");
    });
  } catch (e) {}

  try {
    navigator.mediaSession.setActionHandler("stop", async () => {
      logEvent("🎧 [Headphone]: Stop / Toggle", "highlight");
      await sendMediaControl("play_pause");
    });
  } catch (e) {}

  // Double-Click Earphone Button (Next Track)
  try {
    navigator.mediaSession.setActionHandler("nexttrack", async () => {
      logEvent("🎧 [Headphone]: Next Song (Double-Tap)", "highlight");
      await sendMediaControl("next");
    });
  } catch (e) {}

  // Triple-Click Earphone Button (Previous Track)
  try {
    navigator.mediaSession.setActionHandler("previoustrack", async () => {
      logEvent("🎧 [Headphone]: Previous Song (Triple-Tap)", "highlight");
      await sendMediaControl("previous");
    });
  } catch (e) {}

  // Some Bluetooth remotes send seekforward / seekbackward on hold
  try {
    navigator.mediaSession.setActionHandler("seekforward", async () => {
      logEvent("🎧 [Headphone]: Seek Forward / Next", "highlight");
      await sendMediaControl("next");
    });
  } catch (e) {}

  try {
    navigator.mediaSession.setActionHandler("seekbackward", async () => {
      logEvent("🎧 [Headphone]: Seek Backward / Prev", "highlight");
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
      setTimeout(refreshMediaInfo, 350);
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

  // Initial fetch of media info
  refreshMediaInfo();
}
