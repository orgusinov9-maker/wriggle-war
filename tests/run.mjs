/**
 * Headless test runner.
 *
 * The whole simulation is pure logic sitting behind a canvas API, so it runs
 * in Node once `ImageData` and `document` are stubbed - which each check does
 * at its own top. esbuild bundles the TypeScript; Node runs the result.
 *
 *   npm run check              all checks
 *   npm run check -- arsenal   just the arsenal
 *
 * The checks report themselves in prose, so this runner judges them the same
 * way a person would: any line saying FAIL fails the run.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ALL = ['mapcheck', 'physcheck', 'matchcheck', 'arsenalcheck', 'eventcheck', 'spritecheck', 'ropecheck', 'toolcheck'];

const wanted = process.argv.slice(2);
const checks = wanted.length
  ? ALL.filter((name) => wanted.some((w) => name.includes(w)))
  : ALL;

if (checks.length === 0) {
  console.error(`no check matches "${wanted.join(', ')}"; known: ${ALL.join(', ')}`);
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), 'worms-check-'));
const broken = [];

try {
  for (const name of checks) {
    console.log(`\n=== ${name} ===`);
    const bundle = join(out, `${name}.mjs`);
    try {
      execFileSync(
        'npx',
        ['esbuild', '--bundle', '--platform=node', '--format=esm',
         join(HERE, `${name}.ts`), `--outfile=${bundle}`, '--log-level=warning'],
        { stdio: 'inherit', shell: process.platform === 'win32' },
      );
      const output = execFileSync('node', [bundle], { encoding: 'utf8' });
      process.stdout.write(output);
      if (/\bFAIL\b/.test(output)) broken.push(name);
    } catch (err) {
      if (err.stdout) process.stdout.write(err.stdout);
      if (err.stderr) process.stderr.write(err.stderr);
      broken.push(name);
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(
  broken.length === 0
    ? `\nall checks passed (${checks.join(', ')})`
    : `\nFAILED: ${broken.join(', ')}`,
);
process.exit(broken.length === 0 ? 0 : 1);
