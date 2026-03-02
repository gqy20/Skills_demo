export const QUICK_PROMPTS = [
  {
    icon: "📚",
    title: "文献综述分析",
    desc: "提取研究问题、方法与研究空白",
    text: "请基于当前文献目录，提取研究问题、方法、结论并给出研究空白。"
  },
  {
    icon: "✍️",
    title: "科研初稿生成",
    desc: "生成摘要、方法、实验设计初稿",
    text: "请根据已有文献与项目背景，生成研究报告初稿（摘要、方法、实验设计、讨论）。"
  }
];

export function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
