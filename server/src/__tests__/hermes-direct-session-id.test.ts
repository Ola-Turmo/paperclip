import { describe, expect, it } from "vitest";
import { normalizeHermesSessionId } from "../adapters/hermes-direct.ts";

describe("hermes direct session id parsing", () => {
  it("rejects prose captured by the legacy session regex", () => {
    expect(normalizeHermesSessionId("from")).toBeNull();
    expect(normalizeHermesSessionId("previous")).toBeNull();
    expect(normalizeHermesSessionId("cli")).toBeNull();
  });

  it("accepts real Hermes session ids", () => {
    expect(normalizeHermesSessionId("20260513_081219_fd3d2f")).toBe("20260513_081219_fd3d2f");
    expect(normalizeHermesSessionId("desktop-thread-mp2wj6po-mjavma")).toBe("desktop-thread-mp2wj6po-mjavma");
    expect(normalizeHermesSessionId("run_9674b4b924814efabe0fd69c43945e00")).toBe("run_9674b4b924814efabe0fd69c43945e00");
    expect(normalizeHermesSessionId("cron_98681099a110_20260513_051835")).toBe("cron_98681099a110_20260513_051835");
  });
});
