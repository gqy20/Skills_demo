import { useEffect } from "react";

function resizeTextarea(el) {
  if (!el) return;
  el.style.height = "0px";
  const next = Math.min(el.scrollHeight, 184);
  el.style.height = `${Math.max(next, 46)}px`;
}

export function useAppEffects({
  loadWorkspaces,
  currentWorkspaceId,
  loadSettings,
  loadSkills,
  loadMcps,
  loadFiles,
  loadSessions,
  setOpenedFile,
  setFileLoading,
  setFileSaving,
  setFileError,
  timelineRef,
  messages,
  isStreaming,
  blockingPending,
  setNowTick,
  inputText,
  textareaRef
}) {
  useEffect(() => {
    loadWorkspaces().catch(() => {});
  }, [loadWorkspaces]);

  useEffect(() => {
    loadSettings().catch(() => {});
    loadSkills().catch(() => {});
    loadMcps().catch(() => {});
    loadFiles().catch(() => {});
    loadSessions().catch(() => {});
  }, [currentWorkspaceId, loadFiles, loadMcps, loadSettings, loadSkills, loadSessions]);

  useEffect(() => {
    setOpenedFile(null);
    setFileLoading(false);
    setFileSaving(false);
    setFileError("");
  }, [currentWorkspaceId, setOpenedFile, setFileLoading, setFileSaving, setFileError]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadSkills().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [loadSkills]);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, isStreaming, blockingPending, timelineRef]);

  useEffect(() => {
    if (!isStreaming && !blockingPending) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isStreaming, blockingPending, setNowTick]);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [inputText, textareaRef]);
}
