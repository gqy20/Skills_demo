export type RuntimeSettings = {
  model: string;
  baseUrl: string;
  authToken: string;
  mcpEnabled: boolean;
  speedModeEnabled: boolean;
  toolGateEnabled: boolean;
  debugEnabled: boolean;
  debugSseEnabled: boolean;
};

export type SkillItem = {
  name: string;
  description: string;
  argumentHint: string;
  source: "project" | "user";
};

export type FileTreeItem = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  mtimeMs: number;
  hasChildren?: boolean;
  children?: FileTreeItem[];
};

export type IgnoreRuleSet = {
  prefixes: Set<string>;
  names: Set<string>;
};

export type WorkspaceInfo = {
  id: string;
  label: string;
  root: string;
};
