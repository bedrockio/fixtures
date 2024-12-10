export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Could not find env variable "${name}".`);
  }
  return value;
}
