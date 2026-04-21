import { promises as fs } from "node:fs";
import { unprocessable } from "../errors.js";

function isGitHubDotCom(hostname: string) {
  const h = hostname.toLowerCase();
  return h === "github.com" || h === "www.github.com";
}

export function gitHubApiBase(hostname: string) {
  return isGitHubDotCom(hostname) ? "https://api.github.com" : `https://${hostname}/api/v3`;
}

export function resolveRawGitHubUrl(hostname: string, owner: string, repo: string, ref: string, filePath: string) {
  const p = filePath.replace(/^\/+/, "");
  return isGitHubDotCom(hostname)
    ? `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${p}`
    : `https://${hostname}/raw/${owner}/${repo}/${ref}/${p}`;
}

let cachedGitHubTokens: Map<string, string> | null = null;

async function readGitHubHostsFile() {
  for (const candidate of [
    process.env.GITHUB_HOSTS_FILE,
    "/paperclip-seed/gh/hosts.yml",
    `${process.env.XDG_CONFIG_HOME ?? `${process.env.HOME ?? ""}/.config`}/gh/hosts.yml`,
  ]) {
    if (!candidate) continue;
    try {
      return await fs.readFile(candidate, "utf8");
    } catch {
      continue;
    }
  }
  return null;
}

function parseGitHubTokens(raw: string) {
  const out = new Map<string, string>();
  let currentHost: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const hostMatch = /^([A-Za-z0-9.-]+):\s*$/.exec(line);
    if (hostMatch) {
      currentHost = hostMatch[1]!.toLowerCase();
      continue;
    }
    if (!currentHost) continue;
    const tokenMatch = /^\s*oauth_token:\s*(\S+)\s*$/.exec(line);
    if (tokenMatch && !out.has(currentHost)) {
      out.set(currentHost, tokenMatch[1]!);
    }
  }
  return out;
}

async function resolveGitHubToken(hostname: string) {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) return envToken;
  if (!cachedGitHubTokens) {
    const hostsRaw = await readGitHubHostsFile();
    cachedGitHubTokens = hostsRaw ? parseGitHubTokens(hostsRaw) : new Map();
  }
  return cachedGitHubTokens.get(hostname.toLowerCase()) ?? null;
}

export async function ghFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    const target = new URL(url);
    const hostname = target.hostname.toLowerCase();
    const headers = new Headers(init?.headers);
    const token = await resolveGitHubToken(hostname);
    if (token && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }
    if (!headers.has("user-agent")) {
      headers.set("user-agent", "paperclip-github-fetch");
    }
    if (!headers.has("accept")) {
      headers.set("accept", "application/vnd.github+json");
    }
    return await fetch(url, { ...init, headers });
  } catch {
    throw unprocessable(`Could not connect to ${new URL(url).hostname} - ensure the URL points to a GitHub or GitHub Enterprise instance`);
  }
}
