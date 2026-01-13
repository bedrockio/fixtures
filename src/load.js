import logger from '@bedrockio/logger';
import mongoose from 'mongoose';

import { requireEnv } from './env';
import { importFixtures, logStats, resetStats } from './import';

// Loads fixtures once if not loaded and returns true/false.
export async function loadFixtures() {
  const adminEmail = requireEnv('ADMIN_EMAIL');

  const adminUser = await mongoose.models.User.existsWithDeleted({
    $or: [
      {
        email: adminEmail,
      },
      {
        'roles.role': ['admin', 'superAdmin'],
      },
    ],
  });

  if (adminUser) {
    return false;
  }

  logger.info('Starting fixture import...');
  resetStats();
  await importFixtures();
  logStats();
  return true;
}
