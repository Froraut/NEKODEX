import { useEffect, useRef } from "react";
import type { CatReaction } from "./BrandMark";

// Animate the approved original pixels without changing the silhouette.
export function CatTail({ reaction, art, id }: { reaction: CatReaction | null; art: string; id: string }) {
  const group = useRef<SVGGElement>(null);
  const angle = useRef(0), speed = useRef(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, last = 0, nextMove = 0, target = 0;
    let direction = angle.current > 0 ? -1 : 1;
    const reset = () => { angle.current = 0; speed.current = 0; group.current?.removeAttribute("transform"); };
    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      if (now >= nextMove) {
        target = direction * (reaction ? 11 + Math.random() * 3 : 5 + Math.random() * 2);
        direction *= -1;
        nextMove = now + (reaction ? 1800 : 2800) + Math.random() * 700;
      }
      speed.current += ((target - angle.current) * 10 - speed.current * 6.5) * dt;
      angle.current += speed.current * dt;
      group.current?.setAttribute("transform", `rotate(${angle.current.toFixed(3)} 514 710)`);
      frame = requestAnimationFrame(tick);
    };
    const resume = () => {
      cancelAnimationFrame(frame); last = 0;
      if (reduced.matches) reset();
      else if (!document.hidden) frame = requestAnimationFrame(tick);
    };
    reduced.addEventListener("change", resume);
    document.addEventListener("visibilitychange", resume);
    resume();
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener("change", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [reaction]);
  return <>
    <defs><clipPath id={`${id}-original-tail`}><rect x="390" y="430" width="125" height="319" /></clipPath></defs>
    <g ref={group} className="coding-cat-tail">
      <image href={art} width="1536" height="1024" clipPath={`url(#${id}-original-tail)`} />
    </g>
  </>;
}
