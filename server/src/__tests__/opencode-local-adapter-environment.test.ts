import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { testEnvironment } from "@paperclipai/adapter-opencode-local/server";

async function makeFakeOpencode(scriptLines: string[]) {
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-env-bin-"));
  const configHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-env-config-"));
  const command = path.join(binDir, "opencode");
  await fs.writeFile(command, `${scriptLines.join("\n")}\n`, "utf8");
  await fs.chmod(command, 0o755);
  return {
    command,
    configHome,
    cleanup: async () => {
      await fs.rm(binDir, { recursive: true, force: true });
      await fs.rm(configHome, { recursive: true, force: true });
    },
  };
}

describe("opencode_local environment diagnostics", () => {
  it("reports a missing working directory as an error when cwd is absolute", async () => {
    const fakeOpenCode = await makeFakeOpencode(["#!/bin/sh", "exit 0"]);
    const cwd = path.join(
      os.tmpdir(),
      `paperclip-opencode-local-cwd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      "workspace",
    );

    try {
      await fs.rm(path.dirname(cwd), { recursive: true, force: true });

      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "opencode_local",
        config: {
          command: fakeOpenCode.command,
          cwd,
          env: {
            XDG_CONFIG_HOME: fakeOpenCode.configHome,
          },
        },
      });

      expect(result.checks.some((check) => check.code === "opencode_cwd_invalid")).toBe(true);
      expect(result.checks.some((check) => check.level === "error")).toBe(true);
      expect(result.status).toBe("fail");
    } finally {
      await fakeOpenCode.cleanup();
    }
  });

  it("treats an empty OPENAI_API_KEY override as missing", async () => {
    const fakeOpenCode = await makeFakeOpencode(["#!/bin/sh", "exit 0"]);
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-env-empty-key-"));
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-host-value";

    try {
      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "opencode_local",
        config: {
          command: fakeOpenCode.command,
          cwd,
          env: {
            OPENAI_API_KEY: "",
            XDG_CONFIG_HOME: fakeOpenCode.configHome,
          },
        },
      });

      const missingCheck = result.checks.find((check) => check.code === "opencode_openai_api_key_missing");
      expect(missingCheck).toBeTruthy();
      expect(missingCheck?.hint).toContain("empty");
    } finally {
      if (originalOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiKey;
      }
      await fs.rm(cwd, { recursive: true, force: true });
      await fakeOpenCode.cleanup();
    }
  });

  it("classifies ProviderModelNotFoundError probe output as model-unavailable warning", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-env-probe-cwd-"));
    const fakeOpenCode = await makeFakeOpencode([
      "#!/bin/sh",
      "echo 'ProviderModelNotFoundError: ProviderModelNotFoundError' 1>&2",
      "echo 'data: { providerID: \"openai\", modelID: \"gpt-5.3-codex\", suggestions: [] }' 1>&2",
      "exit 1",
    ]);

    try {
      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "opencode_local",
        config: {
          command: fakeOpenCode.command,
          cwd,
          env: {
            XDG_CONFIG_HOME: fakeOpenCode.configHome,
          },
        },
      });

      const modelCheck = result.checks.find((check) => check.code === "opencode_hello_probe_model_unavailable");
      expect(modelCheck).toBeTruthy();
      expect(modelCheck?.level).toBe("warn");
      expect(result.status).toBe("warn");
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
      await fakeOpenCode.cleanup();
    }
  });
});
