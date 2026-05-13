import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "./types.js";
import { createGatewayAdapter } from "./shared/gateway-prompt.js";

export const { execute, testEnvironment } = createGatewayAdapter({
  adapterLabel: "hermes-gateway",
  adapterType: "hermes_local",
  defaultModel: "custom-theclawbay/gpt-5.5",
  defaultProvider: "cloudflare-native",
  providerInPayload: "hermesAgent",
  defaultTimeoutSec: 600,
  maxTimeoutSec: 900,
  defaultPaperclipApiUrl: "http://paperclip:3100/api",
  healthCheck: true,
  retryAttempts: 7,
  allowAbortRetry: true,
});

export async function executeHermesGateway(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  return execute(ctx);
}
