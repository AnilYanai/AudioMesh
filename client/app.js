/**
 * @file app.js
 * @description VoiceMorph Client Legacy Loader & Architectural Guide.
 *
 * NOTE: The monolithic 1,763-line app.js has been decomposed into modular, single-responsibility
 * ES6 modules inside the `client/js/` directory for readability, maintainability, and testing:
 *
 * 📁 client/js/
 * ├── state.js           - Central reactive state, DOM cache, logging & telemetry (234 lines)
 * ├── audio-core.js      - Web Audio API graph, microphone lifecycle, RMS & noise gate (474 lines)
 * ├── voice-ws.js        - Conversion WebSocket /ws, heartbeat, feedback-free router (275 lines)
 * ├── ptt.js             - Walkie-Talkie Push-to-Talk gestures & PCM chunking (161 lines)
 * ├── live-stream.js     - Real-time continuous live streaming engine (80 lines)
 * ├── target-pc.js       - Virtual Mic driver verification & routing configuration (193 lines)
 * ├── pc-audio.js        - PC Desktop/Call audio downlink /ws/pc_audio & jitter buffer (264 lines)
 * ├── room-calibrator.js - 1.5-second ambient room noise calibration engine (112 lines)
 * ├── visualizer.js      - Audio frequency bar visualizer & idle wave animation (63 lines)
 * ├── ui-controls.js     - Sliders, vocal profile buttons, engine toggle & tab navigation (248 lines)
 * └── main.js            - Application bootstrap and developer diagnostics handle (71 lines)
 *
 * For direct browser inspection, the global diagnostic object is available at:
 * `window.VoiceMorph` in DevTools console.
 */

import "./js/main.js";
