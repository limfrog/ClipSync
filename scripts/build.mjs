import { build as bundle } from 'esbuild';
import { build as renderer } from 'vite';
import { rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await bundle({
  entryPoints: { main: 'src/main/index.ts', preload: 'src/main/preload.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', 'hyperswarm'],
  sourcemap: true,
});
await renderer({
  configFile: false,
  root: 'src/renderer',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: false },
});
