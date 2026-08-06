declare global {
  interface Window {
    __VTT_CHURN_DIAGNOSTICS__?: boolean;
  }
}

const renderCounts = new Map<string, number>();

export function isChurnDiagnosticsEnabled(): boolean {
  return typeof window !== 'undefined' && window.__VTT_CHURN_DIAGNOSTICS__ === true;
}

// No-op while renderCounts has nothing calling it yet (real stores/selectors land in Stage 3) —
// see docs/architecture/STATE-AND-RESILIENCE.md#dev-tooling.
export function trackSubscriptionRender(subscriptionKey: string): void {
  if (!isChurnDiagnosticsEnabled()) return;

  const count = (renderCounts.get(subscriptionKey) ?? 0) + 1;
  renderCounts.set(subscriptionKey, count);
  console.debug(`[churn-diagnostics] ${subscriptionKey}: ${count} renders`);
}

export function resetChurnDiagnostics(): void {
  renderCounts.clear();
}
