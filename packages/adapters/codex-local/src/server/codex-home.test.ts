import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareManagedCodexHome, resolveSharedCodexHomeDir } from "./codex-home.js";

describe("codex home helpers", () => {
  it("prefers CODEX_HOME over PAPERCLIP_HOME when both are present", () => {
    expect(
      resolveSharedCodexHomeDir({
        CODEX_HOME: "/tmp/codex-shared",
        PAPERCLIP_HOME: "/tmp/paperclip-home",
      }),
    ).toBe(path.resolve("/tmp/codex-shared"));
  });

  it("falls back to PAPERCLIP_HOME/.codex before ~/.codex", () => {
    expect(
      resolveSharedCodexHomeDir({
        PAPERCLIP_HOME: "/tmp/paperclip-home",
      }),
    ).toBe(path.resolve("/tmp/paperclip-home", ".codex"));
  });

  it("seeds managed homes from PAPERCLIP_HOME/.codex when CODEX_HOME is unset", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-home-"));
    const paperclipHome = path.join(root, "paperclip-home");
    const sharedCodexHome = path.join(paperclipHome, ".codex");
    const managedHome = path.join(
      paperclipHome,
      "instances",
      "default",
      "companies",
      "company-1",
      "codex-home",
    );

    try {
      await fs.mkdir(sharedCodexHome, { recursive: true });
      await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token":"shared"}\n', "utf8");
      await fs.writeFile(path.join(sharedCodexHome, ".credentials.json"), '{"mcp":"oauth"}\n', "utf8");
      await fs.writeFile(path.join(sharedCodexHome, "config.toml"), 'model = "gpt-5.4"\n', "utf8");

      const logs: string[] = [];
      const prepared = await prepareManagedCodexHome(
        {
          PAPERCLIP_HOME: paperclipHome,
        },
        async (_stream, chunk) => {
          logs.push(chunk);
        },
        "company-1",
      );

      expect(prepared).toBe(managedHome);
      expect((await fs.lstat(path.join(managedHome, "auth.json"))).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(path.join(managedHome, "auth.json"))).toBe(
        await fs.realpath(path.join(sharedCodexHome, "auth.json")),
      );
      expect(await fs.readFile(path.join(managedHome, ".credentials.json"), "utf8")).toBe('{"mcp":"oauth"}\n');
      expect(await fs.readFile(path.join(managedHome, "config.toml"), "utf8")).toBe('model = "gpt-5.4"\n');
      expect(logs.join("")).toContain(`seeded from "${sharedCodexHome}"`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
