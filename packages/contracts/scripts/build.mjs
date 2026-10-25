import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(packageDir, 'dist');

rmSync(distDir, { recursive: true, force: true });

for (const config of ['tsconfig.json', 'tsconfig.esm.json']) {
  const result = spawnSync('tsc', ['-p', config], {
    cwd: packageDir,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const esmDir = resolve(distDir, 'esm');
mkdirSync(esmDir, { recursive: true });
writeFileSync(resolve(esmDir, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
