import { useMemo } from "react";
import { flattenFiles } from "../lib/chatUtils.js";

export function buildSkillSourceCounts(skills) {
  const counts = { all: skills.length, project: 0, user: 0 };
  for (const item of skills) {
    const src = String(item?.source || "").toLowerCase();
    if (src === "project") counts.project += 1;
    if (src === "user") counts.user += 1;
  }
  return counts;
}

export function filterSkillsList(skills, skillSourceTab, skillFilter) {
  const q = String(skillFilter || "").trim().toLowerCase();
  return skills.filter((item) => {
    const src = String(item?.source || "").toLowerCase();
    if (skillSourceTab !== "all" && src !== skillSourceTab) return false;
    if (!q) return true;
    const text = `${item?.name || ""} ${item?.description || ""} ${item?.source || ""}`.toLowerCase();
    return text.includes(q);
  });
}

export function filterFilesList(files, fileFilter) {
  const q = String(fileFilter || "").trim().toLowerCase();
  if (!q) return files;
  return files.filter((item) => `${item?.name || ""} ${item?.path || ""}`.toLowerCase().includes(q));
}

export function useSidebarDerived({ skills, skillSourceTab, skillFilter, files, fileFilter }) {
  const skillSourceCounts = useMemo(() => buildSkillSourceCounts(skills), [skills]);
  const filteredSkills = useMemo(() => filterSkillsList(skills, skillSourceTab, skillFilter), [skills, skillSourceTab, skillFilter]);
  const flattenedFiles = useMemo(() => flattenFiles(files), [files]);
  const filteredFiles = useMemo(() => filterFilesList(flattenedFiles, fileFilter), [flattenedFiles, fileFilter]);
  return { skillSourceCounts, filteredSkills, filteredFiles };
}
