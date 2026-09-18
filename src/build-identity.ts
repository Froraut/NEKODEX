import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "./version";

export interface BuildIdentity {
  version: string;
  commit?: string;
  dirty?: boolean;
  builtAt?: string;
  bundleId?: string;
}

/** Read only the manifest adjacent to this runtime, never an arbitrary other installation. */
export function runtimeBuildIdentity(): BuildIdentity {
  try {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "manifest.json"), "utf8"));
    const build = manifest.build;
    return {
      version: VERSION,
      ...(typeof manifest.bundleId === "string" && /^[a-f0-9]{64}$/.test(manifest.bundleId)
        ? { bundleId: manifest.bundleId } : {}),
      ...(typeof build?.commit === "string" && /^[a-f0-9]{40,64}$/.test(build.commit)
        ? { commit: build.commit } : {}),
      ...(typeof build?.dirty === "boolean" ? { dirty: build.dirty } : {}),
      ...(typeof build?.builtAt === "string" && Number.isFinite(Date.parse(build.builtAt))
        ? { builtAt: build.builtAt } : {}),
    };
  } catch { return { version: VERSION }; }
}
