import { describe, expect, it } from 'vitest';

import * as kit from './index.js';

describe('ui-kit', () => {
  it('exports a module', () => {
    expect(kit).toBeTypeOf('object');
  });
});
