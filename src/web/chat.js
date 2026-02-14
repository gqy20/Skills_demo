function parseSseChunk(chunk, stateRef, onPayload) {
  stateRef.buffer += chunk;
  const parts = stateRef.buffer.split("\n\n");
  stateRef.buffer = parts.pop() || "";

  for (const part of parts) {
    const lines = part.split("\n");
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }

    const rawData = dataLines.join("\n");
    if (!rawData) continue;
    if (rawData === "[DONE]") {
      onPayload({ type: "done" });
      continue;
    }

    try {
      onPayload(JSON.parse(rawData));
    } catch {
      // Ignore malformed frame.
    }
  }
}

export async function streamChatUi({ message, workspaceId, sessionId, signal, onPayload }) {
  const response = await fetch("/api/chat/ui", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      workspaceId: workspaceId || undefined,
      id: sessionId || undefined,
      messages: [{ role: "user", content: message }]
    })
  });

  if (!response.ok) {
    throw new Error((await response.text()) || response.statusText);
  }

  if (!response.body) {
    throw new Error("浏览器不支持流式读取");
  }

  const streamState = { buffer: "" };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parseSseChunk(decoder.decode(value, { stream: true }), streamState, onPayload);
  }
}
