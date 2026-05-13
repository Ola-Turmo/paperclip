import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "./types.js";
import { createGatewayAdapter } from "./shared/gateway-prompt.js";

export const { execute, testEnvironment } = createGatewayAdapter({
  adapterLabel: "omx-gateway",
  adapterType: "omx_local",
  defaultModel: "gpt-5.4",
  defaultProvider: "ohMyCodex",
  providerInPayload: "ohMyCodex",
  defaultTimeoutSec: 900,
  defaultPaperclipApiUrl: "http://paperclip:3100/api",
  healthCheck: false,
  retryAttempts: 5,
  allowAbortRetry: false,
});

export async function executeOmxGateway(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  return execute(ctx);
}
