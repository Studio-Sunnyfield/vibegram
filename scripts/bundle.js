#!/usr/bin/env node
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index-node.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'app/bot-bundle.cjs',
  format: 'cjs',
  // Bundle everything including grammy
});

console.log('Bundle created: app/bot-bundle.cjs');
