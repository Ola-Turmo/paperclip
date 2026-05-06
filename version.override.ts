import { createRequire } from "node:module";

type PackageJson = {
  version?: string;
};

function normalizeReleaseVersion(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  return value.replace(/^v/, "");
}

function normalizeReleaseCommit(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  return value.slice(0, 7);
}

function normalizeSourceRef(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  return value;
}

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as PackageJson;
const releaseVersion = normalizeReleaseVersion(process.env.PAPERCLIP_RELEASE_TAG);
const releaseCommit = normalizeReleaseCommit(process.env.PAPERCLIP_RELEASE_COMMIT);
const sourceRef = normalizeSourceRef(process.env.PAPERCLIP_SOURCE_REF);
const sourceCommit = normalizeReleaseCommit(process.env.PAPERCLIP_SOURCE_COMMIT);
const displayRef = releaseVersion ?? sourceRef;
const displayCommit = releaseCommit ?? sourceCommit;

export const serverVersion = displayRef
  ? `${displayRef}${displayCommit ? ` (${displayCommit})` : ""}`
  : displayCommit
    ? `${pkg.version ?? "0.0.0"} (${displayCommit})`
    : pkg.version ?? "0.0.0";
