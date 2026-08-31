import { createContext, useContext, type ReactNode } from 'react';

/**
 * Radix's `Tooltip`/`ContextMenu.Content` portal to `document.body` by default (via
 * `@radix-ui/react-portal`), which is outside the Shadow DOM the overlay lives in — losing the
 * Radix + theme stylesheets injected only into the shadow root, and the light-DOM host's
 * `z-index: 2147483647` stacking context (main.tsx). This context carries an element that lives
 * inside the shadow tree, set once in main.tsx, so every Radix `Tooltip`/`ContextMenu.Content`
 * can pass it as their `container` prop and portal in-tree instead of to `document.body`.
 *
 * `null` is the "no shadow root yet" default — a component rendered outside of `main.tsx`'s
 * mount (e.g. a future unit test) just falls back to Radix's own `document.body` default.
 */
const ShadowPortalContainerContext = createContext<HTMLElement | null>(null);

export function ShadowPortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement;
  children: ReactNode;
}) {
  return (
    <ShadowPortalContainerContext.Provider value={container}>
      {children}
    </ShadowPortalContainerContext.Provider>
  );
}

/** The shadow-tree portal container, or `undefined` (Radix's own `document.body` default) if none is set. */
export function useShadowPortalContainer(): HTMLElement | undefined {
  return useContext(ShadowPortalContainerContext) ?? undefined;
}
