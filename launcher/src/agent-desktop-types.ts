import type { DesktopPermission, DesktopPermissionClient, MacosDesktopStatus, MacosWindowMetadata, MacosWindowSelection } from '../../src/browser-companion/macos-desktop';
import type { ToolScope } from '../../src/agent-tools/types';
export type { DesktopPermission, DesktopPermissionClient, MacosWindowMetadata, MacosWindowSelection, ToolScope };

/** Cached controller metadata only. No screenshot bytes or arbitrary native commands. */
export interface AgentDesktopStatus {
  providerId: string;
  platform: string;
  state: 'disabled' | 'enabled' | 'unavailable' | 'closed';
  enabled: boolean;
  created: boolean;
  activeCount: number;
  permissions: null | { screenCaptureGranted: boolean; accessibilityGranted: boolean; postEventGranted: boolean };
  /** The identity macOS judged at the last explicit inspection; null before one. */
  permissionClient: DesktopPermissionClient | null;
  nativeStatus: MacosDesktopStatus | null;
  windows: MacosWindowMetadata[];
  selected: MacosWindowSelection | null;
  bindings: { taskId: string; generation: number; selection: MacosWindowSelection; observed: boolean; active: boolean }[];
  reason: string | null;
  restartPolicy: 'off';
  modelImage: { mimeType: 'image/jpeg'; maxBytes: number; coordinateSpace: 'screenshot-pixels' };
}

export interface AgentDesktopToolsProps {
  api: { request(body: Record<string, unknown>): Promise<unknown> };
  desktop?: AgentDesktopStatus | null;
  scope?: ToolScope;
  locked: boolean;
  choose: (en: string, ru: string) => string;
  act: (operation: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
}
