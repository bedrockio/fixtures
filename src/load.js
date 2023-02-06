import logger from '@bedrockio/logger';
import mongoose from 'mongoose';

import { ADMIN_EMAIL } from './const';
import { importFixtures, logStats, resetStats } from './import';

// Loads fixtures once if not loaded and returns true/false.
export async function loadFixtures() {
  if (await mongoose.models.User.findOne({ email: ADMIN_EMAIL })) {
    return false;
  }
  logger.info('Starting fixture import...');
  resetStats();
  await importFixtures();
  logStats();
  return true;
}
