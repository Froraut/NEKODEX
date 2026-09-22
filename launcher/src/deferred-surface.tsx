import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import type { Copy } from './i18n';

type LoadCopy = Pick<Copy, 'loading' | 'failed' | 'reload'>;
class SurfaceError extends Component<{ copy: LoadCopy; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="surface-empty" role="alert">
      <span>{this.props.copy.failed}</span>
      <button type="button" className="button-secondary" onClick={() => window.location.reload()}>{this.props.copy.reload}</button>
    </div> : this.props.children;
  }
}

/** Keep the shell/IPC owner mounted while optional feature code loads. */
export function deferredSurface<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  const Loaded = lazy(load);
  return function DeferredSurface({ loadCopy, ...props }: P & { loadCopy: LoadCopy }) {
    // A failed ES-module fetch can stay cached by the browser. Keep navigation
    // alive and offer an explicit renderer reload, not a retry of that promise.
    return <SurfaceError copy={loadCopy}>
      <Suspense fallback={<div className="surface-empty" role="status">{loadCopy.loading}</div>}>
        <Loaded {...props as P} />
      </Suspense>
    </SurfaceError>;
  };
}
