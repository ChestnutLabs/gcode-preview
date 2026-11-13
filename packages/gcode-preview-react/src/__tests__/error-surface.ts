/** Shared by the React error-surface tests: render under an error boundary and collect what is thrown. */
import { Component, act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

class Boundary extends Component<{ onError: (e: unknown) => void; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    this.props.onError(e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export async function renderCaught(
  el: (extra: Record<string, unknown>) => ReactNode,
  first: Record<string, unknown>,
  then?: Record<string, unknown>
) {
  const errors: unknown[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const originalError = console.error;
  console.error = () => undefined; // React logs caught render errors
  try {
    const wrap = (extra: Record<string, unknown>) =>
      createElement(Boundary, { onError: (e: unknown) => errors.push(e) }, el(extra));
    // A throw from a PASSIVE EFFECT (a prop applied after mount) is re-thrown by React's act in dev builds, so
    // collect it from there; a throw while rendering (a construction option) lands on the boundary.
    const attempt = async (fn: () => void) => {
      try {
        await act(async () => fn());
      } catch (e) {
        errors.push(e);
      }
    };
    await attempt(() => root.render(wrap(first)));
    if (then !== undefined) await attempt(() => root.render(wrap(then)));
    await attempt(() => root.unmount());
  } finally {
    console.error = originalError;
    host.remove();
  }
  return errors;
}
