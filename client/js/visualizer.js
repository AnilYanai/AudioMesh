/**
 * @file visualizer.js
 * @description Real-time audio spectrum frequency bar visualizer with idle sine wave fallback.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, resizeCanvas } from './state.js';

let canvasCtx = null;

export function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);
  if (!elements.canvas) return;
  if (!canvasCtx) {
    canvasCtx = elements.canvas.getContext("2d");
  }
  if (!canvasCtx) return;

  const w = elements.canvas.width || 320;
  const h = elements.canvas.height || 100;
  canvasCtx.clearRect(0, 0, w, h);

  if (!state.analyser) {
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

  const bufferLength = state.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  state.analyser.getByteFrequencyData(dataArray);

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

export function initVisualizer() {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  drawVisualizer();
}
