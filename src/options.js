import path from 'path';

import logger from '@bedrockio/logger';

import { modelTransforms, customTransforms } from './transforms';

const options = {
  baseDir: path.join(process.cwd(), 'fixtures'),
  getRoles: () => {
    logger.warn('getRoles option missing. No roles will be set.');
    return {};
  },
  storeUploadedFile: () => {
    logger.warn('storeUploadedFile option missing. File will not be saved.');
  },
  apiUrl: process.env.API_URL,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminFixtureId: 'users/admin',
  organizationFixtureId: 'organizations/default',
};

export function getBaseDir() {
  return options['baseDir'];
}

export function getOptions() {
  return options;
}

export function setOptions(obj) {
  const {
    modelTransforms: modelTransformAdditions,
    customTransforms: customTransformAdditions,
    ...overrides
  } = obj;
  Object.assign(options, overrides);
  Object.assign(modelTransforms, modelTransformAdditions);
  Object.assign(customTransforms, customTransformAdditions);
}
