import mongoose from 'mongoose';

import { importFixtures } from './import';

export async function cloneFixtures(...args) {
  const imported = await importFixtures(...args);
  return await cloneImported(imported);
}

async function cloneImported(arg) {
  if (arg instanceof mongoose.Document) {
    return await arg.clone();
  } else {
    const result = {};
    for (let [key, value] of Object.entries(arg)) {
      result[key] = await cloneImported(value);
    }
    return result;
  }
}
