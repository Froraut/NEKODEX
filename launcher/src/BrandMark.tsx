import { useEffect, useRef, useState, type PointerEvent } from "react";

const reactions = ["curious", "wink", "happy", "surprised", "sleepy", "yawn", "sneeze", "stretch", "playful", "purr", "peek", "wiggle"] as const;
export type CatReaction = typeof reactions[number];
type Reaction = CatReaction;

function clearTracking(element: HTMLElement | null) {
  element?.style.removeProperty("--neko-x");
  element?.style.removeProperty("--neko-y");
  element?.style.removeProperty("--neko-tilt");
}

// The desktop icon stays still. In-app cats react without changing page state.
export function useCatReaction() {
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const previous = useRef<Reaction | null>(null);
  const queue = useRef<Reaction[]>([]);
  const active = useRef(false);
  const reduced = useRef(false);
  const bounds = useRef<DOMRect | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotionPreference = () => {
      reduced.current = media.matches;
      if (!media.matches) return;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      bounds.current = null;
      pointer.current = null;
      active.current = false;
      clearTracking(target.current);
      setReaction(null);
    };
    syncMotionPreference();
    media.addEventListener("change", syncMotionPreference);
    return () => {
      cancelAnimationFrame(frame.current);
      media.removeEventListener("change", syncMotionPreference);
    };
  }, []);

  const play = () => {
    if (reduced.current || active.current) return;
    active.current = true;
    if (!queue.current.length) {
      const nextCycle: Reaction[] = [...reactions];
      for (let index = nextCycle.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [nextCycle[index], nextCycle[other]] = [nextCycle[other], nextCycle[index]];
      }
      // Avoid repeating at the boundary between shuffled cycles as well.
      if (nextCycle[0] === previous.current) [nextCycle[0], nextCycle[1]] = [nextCycle[1], nextCycle[0]];
      queue.current = nextCycle;
    }
    const next = queue.current.shift()!;
    previous.current = next;
    setReaction(next);
  };

  const flushPointer = () => {
    frame.current = 0;
    const element = target.current;
    const rect = bounds.current;
    const latest = pointer.current;
    if (reduced.current || !element || !rect || !latest) return;
    const x = Math.max(-1, Math.min(1, (latest.x - rect.left) / Math.max(1, rect.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, (latest.y - rect.top) / Math.max(1, rect.height) * 2 - 1));
    element.style.setProperty("--neko-x", `${x * 2.5}px`);
    element.style.setProperty("--neko-y", `${y * 1.8}px`);
    element.style.setProperty("--neko-tilt", `${x * 5}deg`);
  };

  const follow = (event: PointerEvent<HTMLElement>) => {
    if (reduced.current) return;
    target.current = event.currentTarget;
    bounds.current ??= event.currentTarget.getBoundingClientRect();
    pointer.current = { x: event.clientX, y: event.clientY };
    if (!frame.current) frame.current = requestAnimationFrame(flushPointer);
  };
  const begin = (event: PointerEvent<HTMLElement>) => {
    if (reduced.current) return;
    target.current = event.currentTarget;
    bounds.current = event.currentTarget.getBoundingClientRect();
    play();
    follow(event);
  };
  const reset = (element: HTMLElement) => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    bounds.current = null;
    pointer.current = null;
    target.current = null;
    active.current = false;
    setReaction(null);
    clearTracking(element);
  };
  return { reaction, play, begin, follow, reset };
}

export function BrandMark({ small = false }: { small?: boolean }) {
  const { reaction, begin, follow, reset } = useCatReaction();
  return <span
    className={`brand-mark${small ? " is-small" : ""}${reaction ? ` is-reacting reaction-${reaction}` : ""}`}
    role={small ? undefined : "img"}
    aria-label={small ? undefined : "NEKODEX cat"}
    onPointerEnter={begin}
    onPointerMove={follow}
    onPointerLeave={event => reset(event.currentTarget)}
    onPointerCancel={event => reset(event.currentTarget)}
  >
    <svg aria-hidden="true" viewBox="0 0 64 64">
      <CatHead reaction={reaction} />
    </svg>
  </span>;
}

export function CatHead({ reaction }: { reaction: CatReaction | null }) {
  const happy = reaction === "happy" || reaction === "purr" || reaction === "playful";
  const sleepy = reaction === "sleepy" || reaction === "yawn" || reaction === "stretch";
  const closedEyes = sleepy || reaction === "sneeze";
  const mouth = reaction === "yawn" ? "M28 47a4 6 0 1 0 8 0 4 6 0 1 0-8 0"
    : reaction === "surprised" ? "M29 48a3 4 0 1 0 6 0 3 4 0 1 0-6 0"
    : happy || reaction === "wink" || reaction === "wiggle" ? "M27 47q5 7 10 0"
    : reaction === "sneeze" ? "m28 47 8 2-8 2"
    : sleepy ? "M28 48q4-2 8 0" : "m29 47 3 3 3-3";
  return (
      <g className="neko-tracking"><g className="neko-head">
        <path className="neko-ear neko-ear-left" d="M12 34V12l17 12Z" fill="currentColor" />
        <path className="neko-ear neko-ear-right" d="M35 24 52 12v22Z" fill="currentColor" />
        <path d="M12 30c4-7 11-9 20-9s16 2 20 9c4 5 5 10 2 16-4 8-13 12-22 12S14 54 10 46c-3-6-2-11 2-16Z" fill="currentColor" />
        <g className="neko-face" fill="none" stroke="var(--brand-ink, #26243e)" strokeLinecap="round" strokeLinejoin="round">
          <path className="neko-eye neko-eye-left" d={happy ? "M17 40q3-6 6 0" : closedEyes || reaction === "wink" ? "M17 38q3 2 7 0" : "m23 33-6 5 6 5"} strokeWidth="3.5" />
          <path className="neko-eye neko-eye-right" d={happy ? "M41 40q3-6 6 0" : closedEyes ? "M40 38q3 2 7 0" : "m41 33 6 5-6 5"} strokeWidth="3.5" />
          <path className="neko-mouth" d={mouth} strokeWidth="2.5" />
          {reaction === "playful" ? <path className="neko-tongue" d="M28.5 48.5v4a3.5 3.5 0 0 0 7 0v-4" fill="#ef9da9" strokeWidth="1.4" /> : null}
        </g>
      </g></g>
  );
}
