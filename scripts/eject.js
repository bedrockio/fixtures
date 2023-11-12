#!/usr/bin/env node

// Script to eject peer dependencies to a specific node_modules
// directory. This allows yarn link to use the same instance
// of peer dependencies for modules that require them, for
// example mongoose which holds references to its models.
//
// To restore peer dependencies run:
// yarn install --force

import fs from 'fs';
import path from 'path';

const target = process.argv[2];

if (!target) {
  throw new Error('Path required.');
}

const { peerDependencies } = JSON.parse(fs.readFileSync('package.json'));

for (let key of Object.keys(peerDependencies)) {
  const sDir = path.join('node_modules', key);
  const tDir = path.join(target, 'node_modules', key);
  fs.rmSync(sDir, {
    force: true,
    recursive: true,
  });
  fs.symlinkSync(tDir, sDir);
}
