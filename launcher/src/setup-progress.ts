export type SetupNextStep = "sign-in" | "test" | "install" | "catalog" | "confirm" | "tools" | "ready";

export function setupNextStep(state: {
  manual: boolean; signedIn: boolean; smokePassed: boolean; installed: boolean;
  catalogVerified: boolean; pickerConfirmed: boolean; toolsInstalled: boolean;
  toolsVerified: boolean; development: boolean;
}): SetupNextStep {
  if (state.manual && !state.toolsInstalled) return "tools";
  if (!state.manual && !state.signedIn) return "sign-in";
  if (!state.installed) return !state.manual && !state.smokePassed ? "test" : "install";
  if (!state.development && !state.catalogVerified) return "catalog";
  if (!state.development && !state.pickerConfirmed) return "confirm";
  if (state.manual && !state.toolsVerified) return "tools";
  return "ready";
}
