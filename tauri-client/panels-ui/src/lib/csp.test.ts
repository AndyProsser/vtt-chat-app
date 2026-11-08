import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

describe('content security policy', () => {
  // Tauri adds hashes to the CSP, which makes 'unsafe-inline' ineffective: a <style> element created
  // at runtime (or written inline in index.html) is refused. Styles must be linked files.
  it('never creates <style> elements at runtime', () => {
    const sources = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'));
    for (const file of sources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/createElement\(\s*['"]style['"]/);
    }
  });

  it('has no inline <style> in index.html', () => {
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/<style/i);
  });
});
