import { trackSubscriptionRender } from '../lib/churnDiagnostics.js';

// Call from a leaf component's selector hook to count its renders under window.__VTT_CHURN_DIAGNOSTICS__.
export function useChurnDiagnostics(subscriptionKey: string): void {
  trackSubscriptionRender(subscriptionKey);
}
