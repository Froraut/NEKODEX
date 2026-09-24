import type { HttpTrackedEndpoint } from "./http-turn-lifecycle";

export interface InferenceRoutePolicy {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly requiresJson: boolean;
  readonly endpoint: Exclude<HttpTrackedEndpoint, "unspecified">;
  /** Mixed routes enter as native and recheck Web readiness after decoding the model. */
  readonly admission: "native" | "native-or-web" | "web";
}

const routes: readonly InferenceRoutePolicy[] = [
  { method: "GET", path: "/v1/models", requiresJson: false, endpoint: "models", admission: "native" },
  { method: "POST", path: "/v1/responses", requiresJson: true, endpoint: "responses", admission: "native-or-web" },
  { method: "POST", path: "/v1/responses/compact", requiresJson: true, endpoint: "compact", admission: "native-or-web" },
  { method: "POST", path: "/v1/alpha/search", requiresJson: true, endpoint: "search", admission: "native" },
  { method: "POST", path: "/v1/images/generations", requiresJson: false, endpoint: "images/generations", admission: "native" },
  { method: "POST", path: "/v1/images/edits", requiresJson: false, endpoint: "images/edits", admission: "native" },
];

export function inferenceRoutePolicy(method: string, path: string): InferenceRoutePolicy | undefined {
  return routes.find(route => route.method === method && route.path === path);
}
