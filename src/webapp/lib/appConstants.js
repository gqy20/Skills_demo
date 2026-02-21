export const QUICK_PROMPTS = [
  { title: "文献综述分析", text: "请基于当前文献目录，提取研究问题、方法、结论并给出研究空白。" },
  { title: "科研初稿生成", text: "请根据已有文献与项目背景，生成研究报告初稿（摘要、方法、实验设计、讨论）。" }
];

export const QUICK_CHIPS = [
  "先分析文献目录结构",
  "列出研究空白与创新点",
  "基于已有资料生成初稿大纲"
];

export function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
