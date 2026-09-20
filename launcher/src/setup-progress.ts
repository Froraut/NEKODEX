export type SetupNextStep = "sign-in" | "test" | "install" | "catalog" | "confirm" | "tools" | "ready";

export type ModelConnectionReadiness = "not-installed" | "catalog-pending" | "picker-pending" | "available";

export interface SetupReadinessState {
  manual: boolean;
  installed: boolean;
  catalogVerified: boolean;
  pickerConfirmed: boolean;
  development: boolean;
}

/**
 * Manual mode does not inspect the automatic Codex model catalog or picker.
 * Its model-side setup is available once the isolated/core profile exists;
 * connector and tool verification remain separate facts.
 */
export function modelConnectionReadiness(state: SetupReadinessState): ModelConnectionReadiness {
  if (!state.installed) return "not-installed";
  if (state.manual) return "available";
  if (!state.catalogVerified) return "catalog-pending";
  if (!state.development && !state.pickerConfirmed) return "picker-pending";
  return "available";
}

export function setupNextStep(state: {
  manual: boolean; signedIn: boolean; smokePassed: boolean; installed: boolean;
  catalogVerified: boolean; pickerConfirmed: boolean; toolsInstalled: boolean;
  toolsVerified: boolean; development: boolean;
}): SetupNextStep {
  if (state.manual && !state.toolsInstalled) return "tools";
  if (!state.manual && !state.signedIn) return "sign-in";
  if (!state.installed) return !state.manual && !state.smokePassed ? "test" : "install";
  const models = modelConnectionReadiness(state);
  if (models === "catalog-pending") return "catalog";
  if (models === "picker-pending") return "confirm";
  if (state.manual && !state.toolsVerified) return "tools";
  return "ready";
}
