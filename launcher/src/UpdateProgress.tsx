import { useEffect, useRef, useState } from "react";
import { ProgressMeter } from "./design";
import { updateCopyFor } from "./update-copy";
import type { Language, UpdateState } from "./types";

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

export function UpdateProgress({ state, label, language = "en" }: { state: UpdateState; label: string; language?: Language }) {
  const downloading = state.status === "downloading";
  const total = downloading && Number.isFinite(state.totalBytes) && state.totalBytes! > 0 ? state.totalBytes : undefined;
  const bytes = downloading && Number.isFinite(state.downloadedBytes)
    ? Math.max(0, Math.min(total ?? Infinity, state.downloadedBytes!)) : 0;
  const hasSpeed = downloading && Number.isFinite(state.bytesPerSecond);
  const speed = hasSpeed ? Math.max(0, state.bytesPerSecond!) : 0;
  // Only use the backend's observed estimate, never a client-side countdown.
  const remaining = downloading && Number.isFinite(state.remainingSeconds) && state.remainingSeconds! > 0
    && speed > 0 && total !== undefined && Number.isFinite(state.downloadedBytes) && bytes < total
    ? state.remainingSeconds! : undefined;
  const unit = remaining !== undefined && remaining >= 3600 ? "hour"
    : remaining !== undefined && remaining >= 60 ? "minute" : "second";
  const divisor = unit === "hour" ? 3600 : unit === "minute" ? 60 : 1;
  const eta = remaining === undefined ? undefined : updateCopyFor(language).downloadRemaining.replace("{duration}",
    new Intl.NumberFormat(language, { style: "unit", unit, unitDisplay: "short" }).format(Math.ceil(remaining / divisor)));
  const reading = useTransferReading({ bytes, speed }, downloading);
  // No reported total is not evidence that part of the file has arrived: the meter stays indeterminate.
  const fraction = total ? Math.min(1, reading.bytes / total) : 0;
  const decimal = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(language, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const mib = (value: number) => `${decimal.format(value / 1024 / 1024)} MiB`;
  // Accessible values follow telemetry directly, not the visual animation frames.
  const valueText = downloading ? [
    `${mib(bytes)}${total ? ` / ${mib(total)} (${percent.format(bytes / total)})` : ""}`,
    hasSpeed ? `${mib(speed)}/s` : undefined, eta,
  ].filter(Boolean).join("; ") : undefined;
  const figures = downloading ? [
    `${mib(reading.bytes)}${total ? ` / ${mib(total)}` : ""}`, hasSpeed ? `${mib(reading.speed)}/s` : "— MiB/s", eta,
  ].filter(Boolean).join(" · ") : undefined;
  // The bar follows telemetry (the kit fill transitions its width); the figures interpolate between readings.
  return <ProgressMeter className="updates-download" label={label} value={total ? Math.min(1, bytes / total) : null}
    valueLabel={total ? percent.format(fraction) : undefined} valueText={valueText} note={figures} />;
}
