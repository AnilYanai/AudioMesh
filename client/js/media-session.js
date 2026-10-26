/**
 * @file media-session.js
 * @description Hardware headphone remote integration (Play/Pause, Next Track, Prev Track)
 *              via Web Media Session API and Target PC media player control.
 * @author Mathavan & Antigravity
 * @version 20261026_media_v23
 */

import { state, elements, logEvent } from './state.js';

let silentAudioElem = null;
let mediaPollTimer = null;

/**
 * Returns or creates the hidden silent audio element needed by mobile OS (Android/iOS)
 * to keep the MediaSession active on lock screen and intercept headphone hardware buttons.
 */
function getSilentAudioElement() {
  if (!silentAudioElem) {
    silentAudioElem = document.createElement("audio");
    silentAudioElem.loop = true;
    silentAudioElem.playsInline = true;
    silentAudioElem.preload = "auto";
    // 1-second 44.1kHz silent WAV
    silentAudioElem.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
  }
  return silentAudioElem;
}

/**
 * Unlocks the mobile OS Media Session and binds hardware headphone remote keys.
 */
export async function activateMediaSession() {
  try {
    const audio = getSilentAudioElement();
    if (audio.paused) {
      await audio.play();
    }
  } catch (e) {
    // Autoplay restrictions may require user tap
  }

  setupMediaSessionHandlers();
  startMediaPolling();
  refreshMediaInfo();
}

/**
 * Pauses silent keeper when PC audio is stopped.
 */
export function deactivateMediaSession() {
  stopMediaPolling();
  if (silentAudioElem && !silentAudioElem.paused) {
    try {
      silentAudioElem.pause();
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

  try {
    navigator.mediaSession.setActionHandler("play", async () => {
      logEvent("🎧 [Headphone]: Play", "highlight");
      await sendMediaControl("play");
    });
  } catch (e) {}

  try {
    navigator.mediaSession.setActionHandler("pause", async () => {
      logEvent("🎧 [Headphone]: Pause", "highlight");
      await sendMediaControl("pause");
    });
  } catch (e) {}

  try {
    navigator.mediaSession.setActionHandler("nexttrack", async () => {
      logEvent("🎧 [Headphone]: Next Song (Double-Tap)", "highlight");
      await sendMediaControl("next");
    });
  } catch (e) {}

  try {
    navigator.mediaSession.setActionHandler("previoustrack", async () => {
      logEvent("🎧 [Headphone]: Previous Song (Triple-Tap)", "highlight");
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
      sendMediaControl("play_pause");
    });
  }

  if (elements.btnMediaNext) {
    elements.btnMediaNext.addEventListener("click", () => {
      sendMediaControl("next");
    });
  }

  if (elements.btnMediaPrev) {
    elements.btnMediaPrev.addEventListener("click", () => {
      sendMediaControl("previous");
    });
  }

  // Initial fetch of media info
  refreshMediaInfo();
}
