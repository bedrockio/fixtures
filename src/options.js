import path from 'path';

import logger from '@bedrockio/logger';

import { modelTransforms, customTransforms } from './transforms';

const options = {
  baseDir: path.join(process.cwd(), 'fixtures'),
  storeUploadedFile: () => {
    logger.warn('storeUploadedFile option missing. File will not be saved.');
  },
  adminFixtureId: 'users/admin',
  organizationFixtureId: 'organizations/default',
};

export function getBaseDir() {
  return options['baseDir'];
}

export function getOption(name) {
  if (name in options) {
    return options[name];
  } else {
    throw new Error(`Could not find option "${name}".`);
  }
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
