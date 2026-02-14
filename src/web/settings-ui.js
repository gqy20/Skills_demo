export function showSettingsModal(settingsModal, show) {
  settingsModal.classList.toggle("hidden", !show);
  settingsModal.setAttribute("aria-hidden", show ? "false" : "true");
}

export function setMcpEnabled(enabled, { state, toggleMcpBtn, settingMcpEnabledInput }) {
  state.currentMcpEnabled = Boolean(enabled);
  toggleMcpBtn.textContent = `MCP: ${state.currentMcpEnabled ? "ON" : "OFF"}`;
  toggleMcpBtn.classList.toggle("is-off", !state.currentMcpEnabled);
  settingMcpEnabledInput.checked = state.currentMcpEnabled;
}

export function setSpeedModeEnabled(enabled, { state, toggleSpeedBtn, settingSpeedEnabledInput }) {
  state.currentSpeedModeEnabled = Boolean(enabled);
  toggleSpeedBtn.textContent = `Speed: ${state.currentSpeedModeEnabled ? "ON" : "OFF"}`;
  toggleSpeedBtn.classList.toggle("is-off", !state.currentSpeedModeEnabled);
  settingSpeedEnabledInput.checked = state.currentSpeedModeEnabled;
}

export function applySettingsToForm(data, elements) {
  const {
    settingModelInput,
    settingBaseUrlInput,
    settingAuthTokenInput,
    settingToolGateEnabledInput,
    settingDebugEnabledInput,
    settingDebugSseEnabledInput,
    tokenPreviewEl
  } = elements;

  settingModelInput.value = data.model || "";
  settingBaseUrlInput.value = data.baseUrl || "";
  settingAuthTokenInput.value = "";
  settingToolGateEnabledInput.checked = data.toolGateEnabled !== false;
  settingDebugEnabledInput.checked = data.debugEnabled === true;
  settingDebugSseEnabledInput.checked = data.debugSseEnabled === true;
  tokenPreviewEl.textContent = data.hasToken ? `已配置 token: ${data.tokenPreview || "********"}` : "当前未配置 token";
}

export function buildSettingsPayload(elements, { mcpEnabled, speedModeEnabled }) {
  const {
    settingModelInput,
    settingBaseUrlInput,
    settingAuthTokenInput,
    settingToolGateEnabledInput,
    settingDebugEnabledInput,
    settingDebugSseEnabledInput
  } = elements;

  return {
    model: settingModelInput.value.trim(),
    baseUrl: settingBaseUrlInput.value.trim(),
    authToken: settingAuthTokenInput.value.trim(),
    mcpEnabled,
    speedModeEnabled,
    toolGateEnabled: settingToolGateEnabledInput.checked,
    debugEnabled: settingDebugEnabledInput.checked,
    debugSseEnabled: settingDebugSseEnabledInput.checked,
    keepExistingToken: true
  };
}

export function applySavedSettings(data, elements) {
  const { settingAuthTokenInput, tokenPreviewEl } = elements;
  tokenPreviewEl.textContent = data.hasToken ? `已配置 token: ${data.tokenPreview || "********"}` : "当前未配置 token";
  settingAuthTokenInput.value = "";
}
