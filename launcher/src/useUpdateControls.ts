import { useEffect, useRef, useState } from "react";
import { messageOf } from "./launcher-ui";
import type { LauncherApi } from "./types";

/**
 * The outcome of the last update action the user started. `source` says which action it came from, so the
 * Updates screen can title a failed check differently from a failed install. A cancellation that arrives after
 * the worker handoff is information, not a failure (`tone: "info"`).
 */
export type UpdateFeedback = { tone: "error" | "info"; source: "check" | "install" | "cancel"; message: string };

/** Update check, install and cancel state for the Updates screen. App keeps the panel request and restart state. */
export function useUpdateControls(api: LauncherApi, transitionBusy: boolean, copy: { cancelTooLate: string; failed: string }) {
  const [updateError, setUpdateError] = useState<UpdateFeedback | null>(null);
  const [updateCheckCooldown, setUpdateCheckCooldown] = useState(false);
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);
  const [updateInstallPending, setUpdateInstallPending] = useState(false);
  const [updateCancelPending, setUpdateCancelPending] = useState(false);
  const updateCancelInFlight = useRef(false);
  const updateInstallPendingRef = useRef(false);
  const updateCheckTimer = useRef<number | undefined>(undefined);
  const updateCheckMounted = useRef(false);
  const updateCheckPendingRef = useRef(false);
  useEffect(() => {
    updateCheckMounted.current = true;
    return () => {
      updateCheckMounted.current = false;
      window.clearTimeout(updateCheckTimer.current);
    };
  }, []);

  const recheckUpdate = async () => {
    if (transitionBusy || updateCheckCooldown || updateCheckBusy || updateCheckPendingRef.current) return;
    updateCheckPendingRef.current = true;
    setUpdateCheckBusy(true);
    setUpdateError(null);
    try {
      const next = await api.recheckUpdate();
      if (!updateCheckMounted.current) return;
      if (next.status === "error") setUpdateError({ tone: "error", source: "check", message: next.message });
      setUpdateCheckCooldown(true);
      window.clearTimeout(updateCheckTimer.current);
      updateCheckTimer.current = window.setTimeout(() => setUpdateCheckCooldown(false), 60_000);
    } catch (error) {
      if (updateCheckMounted.current) setUpdateError({ tone: "error", source: "check", message: messageOf(error) });
    } finally {
      updateCheckPendingRef.current = false;
      if (updateCheckMounted.current) setUpdateCheckBusy(false);
    }
  };

  const installUpdate = async () => {
    if (updateInstallPendingRef.current) return;
    updateInstallPendingRef.current = true;
    setUpdateInstallPending(true);
    setUpdateError(null);
    try {
      await api.installUpdate();
    } catch (cause) {
      setUpdateError({ tone: "error", source: "install", message: messageOf(cause) });
    } finally {
      updateInstallPendingRef.current = false;
      setUpdateInstallPending(false);
    }
  };

  const cancelUpdate = async () => {
    if (updateCancelInFlight.current) return;
    updateCancelInFlight.current = true;
    setUpdateCancelPending(true);
    setUpdateError(null);
    try {
      const result = await api.cancelUpdatePreparation();
      // Too late is not a failure: the worker already owns the install and NEKODEX reopens when it is done.
      if (result.status === "too-late") setUpdateError({ tone: "info", source: "cancel", message: copy.cancelTooLate });
      else if (result.status === "failed") setUpdateError({ tone: "error", source: "cancel", message: result.message || copy.failed });
    } catch (cause) {
      setUpdateError({ tone: "error", source: "cancel", message: messageOf(cause) });
    } finally {
      updateCancelInFlight.current = false;
      setUpdateCancelPending(false);
    }
  };

  return {
    updateError, setUpdateError, updateCheckCooldown, updateCheckBusy, updateInstallPending, updateCancelPending,
    recheckUpdate, installUpdate, cancelUpdate,
  };
}
