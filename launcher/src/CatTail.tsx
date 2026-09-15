import { useEffect, useRef } from "react";
import type { CatReaction } from "./BrandMark";

// Animate the approved original pixels without changing the silhouette.
const tailArt = new URL("./assets/cat-tail.png", import.meta.url).href;

export function CatTail({ reaction, id }: { reaction: CatReaction | null; id: string }) {
  const group = useRef<SVGGElement>(null);
  const tip = useRef<SVGGElement>(null);
  const tipAngle = useRef(0), tipSpeed = useRef(0);
  const angle = useRef(0), speed = useRef(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, last = 0, nextMove = 0, target = 0, tipTarget = 0, nextTip = 0;
    let outward = angle.current > -6;
    const reset = () => { angle.current = 0; speed.current = 0; group.current?.removeAttribute("transform"); tipAngle.current = 0; tipSpeed.current = 0; tip.current?.removeAttribute("transform"); };
    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      if (now >= nextMove) {
        // Pivot at the upper laptop occlusion point. Keep the cropped right
        // edge behind the screen throughout the sweep.
        target = outward ? -(reaction ? 12 + Math.random() * 3 : 8 + Math.random() * 2) : -(1 + Math.random() * 2);
        outward = !outward;
        nextMove = now + (reaction ? 1800 : 2800) + Math.random() * 700;
      }
      if (now >= nextTip) {
        tipTarget = (Math.random() - .5) * (reaction ? 6 : 3);
        nextTip = now + 1300 + Math.random() * 1500;
      }
      tipSpeed.current += ((tipTarget - tipAngle.current) * 14 - tipSpeed.current * 8) * dt;
      tipAngle.current += tipSpeed.current * dt;
      tip.current?.setAttribute("transform", `rotate(${tipAngle.current.toFixed(3)} 423 534)`);
      speed.current += ((target - angle.current) * 10 - speed.current * 6.5) * dt;
      angle.current += speed.current * dt;
      group.current?.setAttribute("transform", `rotate(${angle.current.toFixed(3)} 515 630)`);
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
    <defs>
      <clipPath id={`${id}-tail-lower`}><rect x="380" y="530" width="160" height="219" /></clipPath>
      <clipPath id={`${id}-tail-tip`}><rect x="380" y="420" width="160" height="118" /></clipPath>
    </defs>
    <g ref={group} className="coding-cat-tail">
      <image href={tailArt} x="380" y="420" width="160" height="330" clipPath={`url(#${id}-tail-lower)`} />
      <g ref={tip}>
        <image href={tailArt} x="380" y="420" width="160" height="330" clipPath={`url(#${id}-tail-tip)`} />
      </g>
    </g>
  </>;
}
