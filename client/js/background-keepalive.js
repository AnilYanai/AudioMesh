/**
 * @file background-keepalive.js
 * @description Background execution anchor for mobile devices (especially Realme/Xiaomi/Samsung).
 *              Uses an inaudible HTML5 Audio loop and navigator.mediaSession to force
 *              the Android OS audio mixer to stay at full sample rate (48kHz) and prevent
 *              CPU downclocking / timer freezing when the screen is locked.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { logEvent } from './state.js';

let keepAliveAudio = null;
let isKeepAliveActive = false;

// 1-second inaudible 44.1kHz PCM WAV carrier in base64
// Plays at 0.001 volume so it occupies the OS AudioTrack without making audible sound
const INAUDIBLE_WAV_BASE64 = 
  "data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YRAAAAAAAAAAAAAAAAAAAAAA";

/**
 * Initializes the background media anchor.
 * Must be triggered by a user touch/click gesture.
 */
export function initBackgroundKeepAlive() {
  if (keepAliveAudio) return;

  try {
    keepAliveAudio = document.createElement("audio");
    keepAliveAudio.setAttribute("playsinline", "");
    keepAliveAudio.setAttribute("loop", "");
    keepAliveAudio.volume = 0.01;
    keepAliveAudio.src = INAUDIBLE_WAV_BASE64;

    // Hook Android MediaSession API (Lock Screen Notification)
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "VoiceMorph Voice Link",
        artist: "Real-time AI Voice Changer",
        album: "Discord / Target PC Active"
      });

      // Maintain playback state so Android never treats the tab as idle
      navigator.mediaSession.setActionHandler("play", () => {
        startBackgroundKeepAlive();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        // Ignored to prevent OS auto-pause on lock screen
      });
    }

    logEvent("🛡️ Background Keep-Alive Engine initialized.", "highlight");
  } catch (e) {
    console.warn("MediaSession initialization note:", e);
  }
}

/**
 * Starts the silent audio carrier loop.
 * Forces Android AudioFlinger to retain high-performance AudioTrack priority.
 */
export async function startBackgroundKeepAlive() {
  if (!keepAliveAudio) {
    initBackgroundKeepAlive();
  }
  if (isKeepAliveActive || !keepAliveAudio) return;

  try {
    await keepAliveAudio.play();
    isKeepAliveActive = true;

    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "playing";
    }

    logEvent("🔒 Lock-Screen Voice Shield Active: Audio clock locked at full frequency.", "success");
  } catch (err) {
    // Autoplay restrictions may require user interaction first
    console.warn("Could not auto-start background keep-alive:", err);
  }
}

/**
 * Stops the silent audio carrier loop when all audio streaming has ended.
 */
export function stopBackgroundKeepAlive() {
  if (keepAliveAudio && isKeepAliveActive) {
    try {
      keepAliveAudio.pause();
    } catch (e) {}
    isKeepAliveActive = false;

    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "none";
    }
    logEvent("Lock-Screen Voice Shield deactivated.");
  }
}
