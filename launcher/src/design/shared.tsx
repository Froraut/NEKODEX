import type { CSSProperties } from "react";
import { Icon, type IconName } from "../icons";

export type { IconName };
export type Status = "idle" | "ready" | "busy" | "error" | "optional";
export type Tone = "neutral" | "accent" | "success" | "warning" | "error" | "outline";

export function cx(...parts: Array<string | false | null | undefined | 0>) {
  return parts.filter(Boolean).join(" ");
}

/** The app's Icon with the system's class and default 16px box (contextual CSS resizes it). */
export function NkIcon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <Icon className="nk-icon" focusable="false" name={name} size={size} />;
}

/** Custom properties in inline styles (e.g. --mark-size). */
export type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>;
