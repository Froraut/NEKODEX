import type { ReactNode } from "react";
import { Panel, cx } from "./design";

/**
 * A kit Panel whose title is an h3: the usage dashboard sits under the "Local usage" h2, and the kit
 * Panel always renders its title as an h2. The header reuses the Panel's own header markup.
 */
export function UsagePanel({ titleId, title, description, actions, className, children }: {
  titleId: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Panel titleId={titleId} className={cx("usage-panel", className)}>
      <header className="nk-panel__header usage-panel__header">
        <h3 className="nk-type-heading" id={titleId}>{title}</h3>
        {actions || null}
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </Panel>
  );
}
