import { useCallback } from "react";
import { parseError } from "../lib/chatUtils.js";

export function buildWorkspaceApiPath(pathname, workspaceId, query = {}) {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspaceId", workspaceId);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function useWorkspaceApi(currentWorkspaceId) {
  const workspaceQuery = useCallback(
    (pathname, query = {}) => buildWorkspaceApiPath(pathname, currentWorkspaceId, query),
    [currentWorkspaceId]
  );

  const apiGetJson = useCallback(
    async (pathname, query = {}) => {
      const url = new URL(workspaceQuery(pathname, query), window.location.origin);
      const res = await fetch(url, { method: "GET" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(parseError(data));
      }
      return data;
    },
    [workspaceQuery]
  );

  const apiPostJson = useCallback(
    async (pathname, body) => {
      const res = await fetch(workspaceQuery(pathname), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: currentWorkspaceId || undefined, ...(body || {}) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(parseError(data));
      return data;
    },
    [currentWorkspaceId, workspaceQuery]
  );

  const apiPutJson = useCallback(
    async (pathname, body) => {
      const res = await fetch(workspaceQuery(pathname), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: currentWorkspaceId || undefined, ...(body || {}) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(parseError(data));
      return data;
    },
    [currentWorkspaceId, workspaceQuery]
  );

  return { workspaceQuery, apiGetJson, apiPostJson, apiPutJson };
}
