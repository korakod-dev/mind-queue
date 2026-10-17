// Shared paths for the media scripts. Everything temporary goes to scripts/media/.work (git-ignored).
import { fileURLToPath } from "node:url";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
export const WORK = path.join(HERE, ".work");
export const SHOTS = path.join(ROOT, "docs/screenshots");
export const BASE = process.env.BASE_URL || "http://localhost:8790";
export const WS_URL = BASE.replace(/^http/, "ws") + "/ws";
mkdirSync(WORK, { recursive: true });

export function hostKey() {
  if (process.env.HOST_KEY) return process.env.HOST_KEY;
  const m = /HOST_KEY=(.*)/.exec(readFileSync(path.join(ROOT, ".dev.vars"), "utf8"));
  if (!m) throw new Error("HOST_KEY missing (.dev.vars or env)");
  return m[1].trim();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
