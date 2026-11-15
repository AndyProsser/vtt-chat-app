import { useState } from 'react';

import { takeTokenFromHash } from '../lib/fragment.js';

/** The token from the emailed link, read once when the page opens (and removed from the address). */
export function useEmailToken(): string | undefined {
  return useState(() => takeTokenFromHash(window.location, window.history))[0];
}
