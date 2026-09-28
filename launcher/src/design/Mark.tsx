import type { CSSProperties } from "react";
import { CatHead, useCatReaction, type CatReaction } from "../BrandMark";
import { cx, type StyleWithVars } from "./shared";

export type { CatReaction };

export interface MarkProps {
  /** Pixel size of the square mark (default 32). */
  size?: number;
  /** Accessible name (default "NEKODEX"); null makes the mark decorative. */
  label?: string | null;
  /** Hover/focus reactions (default true). */
  interactive?: boolean;
  /** Puts the mark in the tab order so keyboard focus plays a reaction. */
  focusable?: boolean;
  /** Pins one expression (face only, no animation). */
  reaction?: CatReaction;
  className?: string;
  style?: CSSProperties;
}

/** The system's BrandMark (`.nk-mark`), drawn with the app's CatHead and useCatReaction rig. */
export function Mark({ size = 32, label = "NEKODEX", interactive = true, focusable = false, reaction, className, style }: MarkProps) {
  const rx = useCatReaction();
  const markStyle: StyleWithVars = { "--mark-size": `${size}px`, ...style };
  return (
    <span
      aria-hidden={label ? undefined : "true"}
      aria-label={label || undefined}
      className={cx("nk-mark", rx.reaction && `is-reacting reaction-${rx.reaction}`, className)}
      onBlur={interactive && focusable ? event => rx.reset(event.currentTarget) : undefined}
      onFocus={interactive && focusable ? rx.play : undefined}
      onPointerCancel={interactive ? event => rx.reset(event.currentTarget) : undefined}
      onPointerEnter={interactive ? rx.begin : undefined}
      onPointerLeave={interactive ? event => rx.reset(event.currentTarget) : undefined}
      onPointerMove={interactive ? rx.follow : undefined}
      role={label ? "img" : undefined}
      style={markStyle}
      tabIndex={focusable ? 0 : undefined}
    >
      <svg aria-hidden="true" viewBox="0 0 64 64"><CatHead reaction={reaction || rx.reaction} /></svg>
    </span>
  );
}
