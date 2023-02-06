import logger from '@bedrockio/logger';
import mongoose from 'mongoose';

import { getOptions } from './options';
import { importFixtures, logStats, resetStats } from './import';

// Loads fixtures once if not loaded and returns true/false.
export async function loadFixtures() {
  const { adminEmail } = getOptions();
  if (await mongoose.models.User.findOne({ email: adminEmail })) {
    return false;
  }
  logger.info('Starting fixture import...');
  resetStats();
  await importFixtures();
  logStats();
  return true;
}
