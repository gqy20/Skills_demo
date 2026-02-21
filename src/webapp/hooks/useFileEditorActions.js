import { useCallback } from "react";
import { parseError } from "../lib/chatUtils.js";

export function mapOpenedFileData(data, requestedPath) {
  const content = typeof data?.content === "string" ? data.content : "";
  const pathValue = typeof data?.path === "string" ? data.path : requestedPath;
  return {
    path: pathValue,
    name: data?.name || pathValue.split("/").pop() || pathValue,
    content,
    savedContent: content,
    mtimeMs: Number(data?.mtimeMs || 0),
    size: Number(data?.size || 0),
    dirty: false
  };
}

export function useFileEditorActions({
  currentWorkspaceId,
  apiGetJson,
  apiPutJson,
  fileLoading,
  fileSaving,
  openedFile,
  setFileLoading,
  setFileSaving,
  setFileError,
  setOpenedFile,
  loadFiles
}) {
  const openFile = useCallback(
    async (filePath) => {
      const nextPath = String(filePath || "").trim();
      if (!nextPath || !currentWorkspaceId) return;
      setFileLoading(true);
      setFileError("");
      try {
        const data = await apiGetJson("/api/file", { path: nextPath });
        setOpenedFile(mapOpenedFileData(data, nextPath));
      } catch (error) {
        setFileError(parseError(error));
      } finally {
        setFileLoading(false);
      }
    },
    [apiGetJson, currentWorkspaceId, setFileError, setFileLoading, setOpenedFile]
  );

  const requestOpenFile = useCallback(
    async (filePath, { force = false } = {}) => {
      const nextPath = String(filePath || "").trim();
      if (!nextPath) return;
      if (openedFile?.path === nextPath && !fileLoading) return;
      if (!force && openedFile?.dirty) {
        const ok = window.confirm("当前文件有未保存修改，是否放弃并切换到其他文件？");
        if (!ok) return;
      }
      await openFile(nextPath);
    },
    [fileLoading, openFile, openedFile?.dirty, openedFile?.path]
  );

  const saveOpenedFile = useCallback(async () => {
    if (!openedFile?.path || fileLoading || fileSaving) return;
    if (!openedFile.dirty) return;
    setFileSaving(true);
    setFileError("");
    try {
      const data = await apiPutJson("/api/file", {
        path: openedFile.path,
        content: openedFile.content,
        expectedMtimeMs: openedFile.mtimeMs
      });
      const mtimeMs = Number(data?.mtimeMs || Date.now());
      setOpenedFile((prev) =>
        prev
          ? {
              ...prev,
              savedContent: prev.content,
              dirty: false,
              mtimeMs,
              size: Number(data?.size || prev.size || 0)
            }
          : prev
      );
      loadFiles().catch(() => {});
    } catch (error) {
      setFileError(parseError(error));
    } finally {
      setFileSaving(false);
    }
  }, [apiPutJson, fileLoading, fileSaving, loadFiles, openedFile, setFileError, setFileSaving, setOpenedFile]);

  return { openFile, requestOpenFile, saveOpenedFile };
}
