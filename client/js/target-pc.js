/**
 * @file target-pc.js
 * @description Manages Target PC Virtual Microphone routing, LAN device discovery,
 *              health verification probes, and receiver driver status diagnostics.
 * @author Mathavan & Antigravity
 * @version 20261025_modular_v18
 */

import { state, elements, logEvent } from './state.js';
import { sendWsJson } from './voice-ws.js';

let verifyTimeoutTimer = null;

// ==========================================
// 1. Status Badges & Routing State Sync
// ==========================================

export function updateRoutingPills() {
  if (elements.pillTargetStatus) {
    if (state.routingConfig.target_pc_enabled) {
      elements.pillTargetStatus.textContent = "🖥️ PC Mic: ON";
      elements.pillTargetStatus.className = "pill-badge active";
    } else {
      elements.pillTargetStatus.textContent = "🖥️ PC Mic: OFF";
      elements.pillTargetStatus.className = "pill-badge disabled";
    }
  }
  if (elements.pillMobileStatus) {
    if (state.routingConfig.mobile_speaker_enabled) {
      elements.pillMobileStatus.textContent = "📱 Mobile: ON";
      elements.pillMobileStatus.className = "pill-badge active";
    } else {
      elements.pillMobileStatus.textContent = "📱 Mobile: OFF";
      elements.pillMobileStatus.className = "pill-badge disabled";
    }
  }
}

export function syncRoutingFromState(cfg) {
  if (!cfg) return;
  state.routingConfig = { ...state.routingConfig, ...cfg };
  if (elements.targetIpInput) elements.targetIpInput.value = state.routingConfig.target_pc_ip || "127.0.0.1";
  if (elements.targetPortInput) elements.targetPortInput.value = state.routingConfig.target_pc_port || 8001;
  if (elements.toggleTargetPc) elements.toggleTargetPc.checked = !!state.routingConfig.target_pc_enabled;
  if (elements.toggleMobileSpeaker) elements.toggleMobileSpeaker.checked = !!state.routingConfig.mobile_speaker_enabled;
  updateRoutingPills();
}

export function sendRoutingUpdate() {
  const ip = elements.targetIpInput ? elements.targetIpInput.value.trim() : state.routingConfig.target_pc_ip;
  const port = elements.targetPortInput ? parseInt(elements.targetPortInput.value) || 8001 : state.routingConfig.target_pc_port;
  const targetEnabled = elements.toggleTargetPc ? elements.toggleTargetPc.checked : state.routingConfig.target_pc_enabled;
  const mobileEnabled = elements.toggleMobileSpeaker ? elements.toggleMobileSpeaker.checked : state.routingConfig.mobile_speaker_enabled;

  state.routingConfig.target_pc_ip = ip;
  state.routingConfig.target_pc_port = port;
  state.routingConfig.target_pc_enabled = targetEnabled;
  state.routingConfig.mobile_speaker_enabled = mobileEnabled;

  updateRoutingPills();

  sendWsJson({
    action: "update_routing",
    target_pc_ip: ip,
    target_pc_port: port,
    target_pc_enabled: targetEnabled,
    mobile_speaker_enabled: mobileEnabled
  });

  logEvent(`Audio Routing: Target PC = ${targetEnabled ? 'ON' : 'OFF'}, Mobile = ${mobileEnabled ? 'ON' : 'OFF'}`);
}

// ==========================================
// 2. Target PC Driver Verification
// ==========================================

export function verifyTargetPC() {
  const ip = elements.targetIpInput ? elements.targetIpInput.value.trim() : "127.0.0.1";
  const port = elements.targetPortInput ? parseInt(elements.targetPortInput.value) || 8001 : 8001;

  logEvent(`🔍 Testing communication with Target PC driver at http://${ip}:${port}...`, "highlight");

  if (elements.targetVerifyBadge) {
    elements.targetVerifyBadge.className = "verify-badge verifying";
    if (elements.targetVerifyText) elements.targetVerifyText.textContent = "Testing...";
  }
  if (elements.btnVerifyTarget) {
    elements.btnVerifyTarget.disabled = true;
    if (elements.verifySpinner) elements.verifySpinner.classList.remove("hidden");
    if (elements.verifyBtnIcon) elements.verifyBtnIcon.textContent = "⏳";
    if (elements.verifyBtnText) elements.verifyBtnText.textContent = "Checking Driver...";
  }
  if (elements.detailsDriverStatus) {
    elements.detailsDriverStatus.textContent = "Connecting to receiver agent...";
    elements.detailsDriverStatus.className = "details-val text-muted";
  }

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    sendWsJson({
      action: "verify_target_pc",
      ip: ip,
      port: port
    });
  } else {
    // REST API fallback
    fetch(`/api/target_pc/verify?ip=${encodeURIComponent(ip)}&port=${port}`)
      .then(res => res.json())
      .then(data => handleTargetPcStatus(data))
      .catch(err => handleTargetPcStatus({ success: false, details: err.message, ip, port }));
  }

  clearTimeout(verifyTimeoutTimer);
  verifyTimeoutTimer = setTimeout(() => {
    if (elements.btnVerifyTarget && elements.btnVerifyTarget.disabled) {
      handleTargetPcStatus({
        success: false,
        ip: ip,
        port: port,
        details: "Timed out waiting for response"
      });
    }
  }, 4000);
}

export function handleTargetPcStatus(data) {
  clearTimeout(verifyTimeoutTimer);
  if (elements.btnVerifyTarget) {
    elements.btnVerifyTarget.disabled = false;
    if (elements.verifySpinner) elements.verifySpinner.classList.add("hidden");
    if (elements.verifyBtnIcon) elements.verifyBtnIcon.textContent = "🔍";
    if (elements.verifyBtnText) elements.verifyBtnText.textContent = "Verify Driver & Connection";
  }

  if (data.success) {
    if (elements.targetVerifyBadge) {
      elements.targetVerifyBadge.className = "verify-badge verified";
      if (elements.targetVerifyText) elements.targetVerifyText.textContent = "Connected ✓";
    }
    if (elements.detailsDriverStatus) {
      elements.detailsDriverStatus.textContent = "🟢 Online & Virtual Mic Ready";
      elements.detailsDriverStatus.className = "details-val";
      elements.detailsDriverStatus.style.color = "#34d399";
    }
    const details = data.details || {};
    if (elements.detailsPlatform) {
      elements.detailsPlatform.textContent = details.platform || "Active";
      elements.detailsPlatform.className = "details-val";
    }
    if (elements.detailsVirtualMic) {
      elements.detailsVirtualMic.textContent = details.virtual_mic || "VoiceMorph Virtual Microphone";
      elements.detailsVirtualMic.className = "details-val";
    }
    logEvent(`✅ Target PC Verified at ${data.ip}:${data.port}! Virtual Mic ready for Discord.`, "success");
  } else {
    if (elements.targetVerifyBadge) {
      elements.targetVerifyBadge.className = "verify-badge offline";
      if (elements.targetVerifyText) elements.targetVerifyText.textContent = "Offline ✗";
    }
    if (elements.detailsDriverStatus) {
      elements.detailsDriverStatus.textContent = "🔴 Unreachable (Driver Not Running)";
      elements.detailsDriverStatus.className = "details-val";
      elements.detailsDriverStatus.style.color = "#f87171";
    }
    if (elements.detailsPlatform) {
      elements.detailsPlatform.textContent = "Unreachable";
      elements.detailsPlatform.className = "details-val text-muted";
    }
    logEvent(`❌ Target PC at ${data.ip}:${data.port} unreachable (${data.details || "Connection refused"}). Start receiver first!`, "error");
  }
}

// ==========================================
// 3. Listener Initialization
// ==========================================

export function initTargetPcListeners() {
  if (elements.btnVerifyTarget) {
    elements.btnVerifyTarget.addEventListener("click", verifyTargetPC);
  }

  if (elements.btnQuickLocalhost) {
    elements.btnQuickLocalhost.addEventListener("click", () => {
      if (elements.targetIpInput) elements.targetIpInput.value = "127.0.0.1";
      sendRoutingUpdate();
      verifyTargetPC();
    });
  }

  if (elements.targetIpInput) elements.targetIpInput.addEventListener("change", sendRoutingUpdate);
  if (elements.targetPortInput) elements.targetPortInput.addEventListener("change", sendRoutingUpdate);
  if (elements.toggleTargetPc) elements.toggleTargetPc.addEventListener("change", sendRoutingUpdate);
  if (elements.toggleMobileSpeaker) elements.toggleMobileSpeaker.addEventListener("change", sendRoutingUpdate);
}
