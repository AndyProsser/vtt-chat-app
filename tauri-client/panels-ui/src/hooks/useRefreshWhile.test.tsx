import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRefreshWhile } from './useRefreshWhile.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ active, refresh }: { active: boolean; refresh: () => void }) {
  useRefreshWhile(active, refresh);
  return null;
}

let root: ReturnType<typeof createRoot> | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});
const show = (active: boolean, refresh: () => void) => {
  const host = document.createElement('div');
  root ??= createRoot(host);
  act(() => root!.render(<Probe active={active} refresh={refresh} />));
};

describe('useRefreshWhile', () => {
  it('refreshes when it becomes active and whenever the window gets focus again', () => {
    const refresh = vi.fn();
    show(true, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does nothing while inactive, and stops listening when it goes inactive', () => {
    const refresh = vi.fn();
    show(false, refresh);
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(refresh).not.toHaveBeenCalled();
    show(true, refresh);
    show(false, refresh);
    refresh.mockClear();
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(refresh).not.toHaveBeenCalled();
  });
});
