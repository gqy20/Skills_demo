export function renderWorkspaceOptions({ workspaceSelectEl, workspaceMetaEl, workspaces, currentWorkspaceId }) {
  workspaceSelectEl.innerHTML = "";
  for (const item of workspaces) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    workspaceSelectEl.appendChild(option);
  }
  if (currentWorkspaceId) {
    workspaceSelectEl.value = currentWorkspaceId;
  }
  const current = workspaces.find((item) => item.id === currentWorkspaceId);
  workspaceMetaEl.textContent = current ? current.root : "";
}
