import { describe, expect, it } from "vitest";
import { normalizeMcpCatalogResponse } from "../../../src/webapp/hooks/useWorkspaceData.js";

describe("normalizeMcpCatalogResponse", () => {
  it("normalizes runtime fields", () => {
    const out = normalizeMcpCatalogResponse(
      {
        mcpEnabled: false,
        runtime: { ok: true, error: "", source: "active", checking: true, lastCheckedAt: 123, ageSeconds: 9, stale: false },
        items: [{ name: "a" }]
      },
      999
    );
    expect(out).toMatchObject({
      loading: false,
      error: "",
      mcpEnabled: false,
      runtime: {
        ok: true,
        error: "",
        source: "active",
        checking: true,
        lastCheckedAt: 123,
        ageSeconds: 9,
        stale: false
      },
      items: [{ name: "a" }],
      updatedAt: 999
    });
  });

  it("falls back to defaults for invalid payload", () => {
    const out = normalizeMcpCatalogResponse({}, 555);
    expect(out.runtime.ok).toBeNull();
    expect(out.items).toEqual([]);
    expect(out.updatedAt).toBe(555);
  });
});
