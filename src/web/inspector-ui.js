function normalizeSkillDescription(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "无描述";
}

export function renderSkills(items, skillsListEl) {
  skillsListEl.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "skills-item";
    const head = document.createElement("div");
    head.className = "skills-head";
    const title = document.createElement("p");
    title.className = "skills-name";
    title.textContent = `/${item.name}`;
    const source = document.createElement("span");
    source.className = "skills-source";
    source.textContent = item.source === "user" ? "user" : "project";
    head.appendChild(title);
    head.appendChild(source);
    const desc = document.createElement("p");
    desc.className = "skills-desc";
    desc.textContent = normalizeSkillDescription(item.description);
    li.appendChild(head);
    li.appendChild(desc);
    if (item.argumentHint) {
      const hint = document.createElement("code");
      hint.className = "skills-arg";
      hint.textContent = item.argumentHint;
      li.appendChild(hint);
    }
    skillsListEl.appendChild(li);
  }
}

function createFileRow(item, level, fileExpanded) {
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `files-row ${item.type === "file" ? "is-file" : "is-dir"}`;
  btn.dataset.path = item.path;
  btn.dataset.type = item.type;
  btn.style.paddingLeft = `${6 + level * 14}px`;

  const indent = document.createElement("span");
  indent.className = "files-indent";
  const toggle = document.createElement("span");
  toggle.className = "files-toggle";
  if (item.type === "directory") {
    const expanded = fileExpanded.has(item.path);
    toggle.textContent = expanded ? "▾" : item.hasChildren ? "▸" : "•";
  } else {
    toggle.textContent = "·";
  }
  const name = document.createElement("span");
  name.className = "files-name";
  name.textContent = item.name;

  btn.appendChild(indent);
  btn.appendChild(toggle);
  btn.appendChild(name);
  li.appendChild(btn);
  return li;
}

function renderFileChildren({ items, level, filesListEl, fileTree, fileExpanded, fileLoading }) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    filesListEl.appendChild(createFileRow(item, level, fileExpanded));
    if (item.type === "directory" && fileExpanded.has(item.path)) {
      const children = fileTree.get(item.path);
      if (children) {
        renderFileChildren({ items: children, level: level + 1, filesListEl, fileTree, fileExpanded, fileLoading });
      } else if (fileLoading.has(item.path)) {
        const loading = document.createElement("li");
        loading.className = "hint";
        loading.style.paddingLeft = `${20 + level * 14}px`;
        loading.textContent = "加载中...";
        filesListEl.appendChild(loading);
      }
    }
  }
}

export function renderFilesPanel({ filesListEl, filesMetaEl, fileTree, fileExpanded, fileLoading }) {
  filesListEl.innerHTML = "";
  const root = fileTree.get("") || [];
  filesMetaEl.textContent = `工作区文件 ${root.length} 项`;
  if (!root.length) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "暂无可展示文件";
    filesListEl.appendChild(li);
    return;
  }

  renderFileChildren({
    items: root,
    level: 0,
    filesListEl,
    fileTree,
    fileExpanded,
    fileLoading
  });
}
