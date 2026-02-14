function buildApiUrl(pathname, params = {}, workspaceId = "") {
  const url = new URL(pathname, window.location.origin);
  const withWorkspace = { ...params };
  if (workspaceId && withWorkspace.workspaceId === undefined) {
    withWorkspace.workspaceId = workspaceId;
  }
  for (const [key, value] of Object.entries(withWorkspace)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

export async function apiGetJson(pathname, params = {}, workspaceId = "") {
  const response = await fetch(buildApiUrl(pathname, params, workspaceId));
  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  return response.json();
}

export async function apiPostJson(pathname, body = {}, workspaceId = "") {
  const payload = { ...body };
  if (workspaceId && payload.workspaceId === undefined) {
    payload.workspaceId = workspaceId;
  }

  const response = await fetch(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  return response.json();
}
