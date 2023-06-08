import { getAll } from '@bedrockio/config';

const ENV = getAll();

export function getEnv(name) {
  if (name in ENV) {
    return ENV[name];
  } else {
    throw new Error(`Could not find env variable "${name}".`);
  }
}
