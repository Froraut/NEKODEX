import { useEffect, useRef, useState } from "react";
import type { UpdateState } from "./types";

type Reading = { bytes: number; speed: number };

/** Interpolate only toward observed values; never extrapolate downloaded bytes. */
function useTransferReading(target: Reading, enabled: boolean): Reading {
  const [reading, setReading] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const from = current.current;
    const start = performance.now();
    const publish = (value: Reading) => { current.current = value; setReading(value); };
    const stop = () => {
      cancelAnimationFrame(frame);
      publish(target);
    };
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / 180));
      const eased = 1 - (1 - t) ** 3;
      publish({ bytes: Math.min(target.bytes, from.bytes + (target.bytes - from.bytes) * eased),
        speed: from.speed + (target.speed - from.speed) * eased });
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    // A restarted transfer, hidden page or accessibility preference must not animate stale values.
    if (!enabled || reduced.matches || document.hidden || target.bytes < from.bytes) stop();
    else frame = requestAnimationFrame(tick);
    const onVisibility = () => { if (document.hidden) stop(); };
    const onMotion = () => { if (reduced.matches) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onMotion);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onMotion);
    };
  }, [target.bytes, target.speed, enabled]);
  return reading;
}

export function UpdateProgress({ state, label }: { state: UpdateState; label: string }) {
  const downloading = state.status === "downloading";
  const total = downloading && Number.isFinite(state.totalBytes) && state.totalBytes! > 0 ? state.totalBytes : undefined;
  const bytes = downloading ? Math.max(0, Math.min(total ?? Infinity, state.downloadedBytes ?? 0)) : 0;
  const speed = downloading ? Math.max(0, state.bytesPerSecond ?? 0) : 0;
  const reading = useTransferReading({ bytes, speed }, downloading);
  const fraction = total ? Math.min(1, reading.bytes / total) : undefined;
  const mib = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;
  return <div className="updates-download">
    <div className={`updates-meter${fraction === undefined ? " is-indeterminate" : ""}`}
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={total ? Math.min(100, bytes / total * 100) : undefined}>
      <span aria-hidden="true" className="updates-meter-fill" style={fraction !== undefined ? { transform: `scaleX(${fraction})` } : undefined} />
    </div>
    {downloading && total ? <div className="updates-transfer"><span>{mib(reading.bytes)} / {mib(total)}</span><strong>{((fraction ?? 0) * 100).toFixed(1)}%</strong></div> : null}
    {downloading ? <small className="updates-speed">{mib(reading.speed)}/s</small> : null}
  </div>;
}
