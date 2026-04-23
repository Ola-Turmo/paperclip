export const TAILSCALE_AUTH_RETRY_INTERVAL_MS = 1_000;
export const TAILSCALE_AUTH_GRACE_WINDOW_MS = 5_000;

export function isTailscaleAutologinHost(hostname: string | null | undefined): boolean {
  return typeof hostname === "string" && hostname.trim().toLowerCase().endsWith(".ts.net");
}
