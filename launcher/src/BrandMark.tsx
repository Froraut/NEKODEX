import { useRef, useState, type PointerEvent } from "react";

const reactions = ["curious", "wink", "happy", "surprised", "sleepy", "yawn", "sneeze", "stretch", "playful", "purr", "peek", "wiggle"] as const;
export type CatReaction = typeof reactions[number];
type Reaction = CatReaction;

// The desktop icon stays still. In-app cats react without changing page state.
export function useCatReaction() {
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const previous = useRef<Reaction | null>(null);
  const queue = useRef<Reaction[]>([]);
  const active = useRef(false);
  const play = () => {
    // Pointer entry followed by focus is one interaction, not two reactions.
    if (active.current) return;
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
  const follow = (event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height) * 2 - 1));
    event.currentTarget.style.setProperty("--neko-x", `${x * 2.5}px`);
    event.currentTarget.style.setProperty("--neko-y", `${y * 1.8}px`);
    event.currentTarget.style.setProperty("--neko-tilt", `${x * 5}deg`);
  };
  const reset = (element: HTMLElement) => {
    active.current = false;
    setReaction(null);
    element.style.removeProperty("--neko-x");
    element.style.removeProperty("--neko-y");
    element.style.removeProperty("--neko-tilt");
  };
  return { reaction, play, follow, reset };
}

export function BrandMark({ small = false }: { small?: boolean }) {
  const { reaction, play, follow, reset } = useCatReaction();
  return <span
    className={`brand-mark${small ? " is-small" : ""}${reaction ? ` is-reacting reaction-${reaction}` : ""}`}
    tabIndex={small ? undefined : 0}
    role={small ? undefined : "img"}
    aria-label={small ? undefined : "NEKODEX cat"}
    onPointerEnter={play}
    onPointerMove={follow}
    onPointerLeave={event => reset(event.currentTarget)}
    onPointerCancel={event => reset(event.currentTarget)}
    onFocus={play}
    onBlur={event => reset(event.currentTarget)}
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
          {reaction === "playful" ? <path className="neko-tongue" d="M30 49v3a2 2 0 0 0 4 0v-3Z" fill="#ef9da9" strokeWidth="1.5" /> : null}
        </g>
      </g></g>
  );
}
