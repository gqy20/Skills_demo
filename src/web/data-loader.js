import { renderWorkspaceOptions as renderWorkspaceSelect } from "./workspace-ui.js";

export function createDataLoader({
  state,
  workspaceSelectEl,
  workspaceMetaEl,
  skillsMetaEl,
  skillsListEl,
  filesMetaEl,
  apiGetJson,
  applySettingsToForm,
  setMcpEnabled,
  setSpeedModeEnabled,
  setToolGateEnabled,
  renderSkills,
  renderFilesPanel
}) {
  let skillsLoading = false;

  function renderWorkspaceOptions() {
    renderWorkspaceSelect({
      workspaceSelectEl,
      workspaceMetaEl,
      workspaces: state.workspaces,
      currentWorkspaceId: state.currentWorkspaceId
    });
  }

  async function loadSettings() {
    const data = await apiGetJson("/api/settings");
    if (data.workspaceId && data.workspaceId !== state.currentWorkspaceId) {
      state.currentWorkspaceId = data.workspaceId;
      renderWorkspaceOptions();
    }
    applySettingsToForm(data);
    setMcpEnabled(data.mcpEnabled !== false);
    setSpeedModeEnabled(data.speedModeEnabled === true);
    setToolGateEnabled(data.toolGateEnabled !== false);
  }

  async function loadFiles(path = "", depth = 1) {
    if (state.fileLoading.has(path)) return;
    state.fileLoading.add(path);
    if (!state.fileTree.has(path)) {
      filesMetaEl.textContent = "加载中...";
    }

    try {
      const data = await apiGetJson("/api/files", { path, depth });
      const items = Array.isArray(data.items) ? data.items : [];
      state.fileTree.set(path, items);
      renderFilesPanel();
    } catch (error) {
      filesMetaEl.textContent = `加载失败: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      state.fileLoading.delete(path);
      renderFilesPanel();
    }
  }

  async function loadSkills() {
    if (skillsLoading) return;
    skillsLoading = true;
    skillsMetaEl.textContent = "加载中...";

    try {
      const data = await apiGetJson("/api/skills");
      const items = Array.isArray(data.items) ? data.items : [];
      skillsMetaEl.textContent = `仅显示用户/项目 skills，共 ${items.length} 个`;
      renderSkills(items);
    } catch (error) {
      skillsMetaEl.textContent = `加载失败: ${error instanceof Error ? error.message : String(error)}`;
      skillsListEl.innerHTML = "";
    } finally {
      skillsLoading = false;
    }
  }

  async function loadWorkspaces() {
    const data = await apiGetJson("/api/workspaces", { workspaceId: "" });
    const items = Array.isArray(data.items) ? data.items : [];
    state.workspaces = items;
    if (!state.currentWorkspaceId) {
      state.currentWorkspaceId = data.currentWorkspaceId || (items[0] ? items[0].id : "");
    }
    renderWorkspaceOptions();
  }

  function startSkillsPolling(intervalMs = 3000) {
    return setInterval(() => {
      if (document.hidden) return;
      loadSkills();
    }, intervalMs);
  }

  return {
    renderWorkspaceOptions,
    loadSettings,
    loadFiles,
    loadSkills,
    loadWorkspaces,
    startSkillsPolling
  };
}
