import path from 'path';
import fs from 'fs/promises';

export async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function resolveFile(file) {
  let resolved;
  resolved ||= await attemptResolve(file);
  resolved ||= await attemptResolve(file + '.js');
  resolved ||= await attemptResolve(file + '.json');
  resolved ||= await attemptResolve(path.join(file, 'index.js'));
  resolved ||= await attemptResolve(path.join(file, 'index.json'));
  return resolved;
}

async function attemptResolve(file) {
  const ext = path.extname(file);
  let type;
  if (ext === '.js') {
    type = 'javascript';
  } else if (ext === '.json') {
    type = 'json';
  } else if (ext) {
    throw new Error(`Unsupported file extension ${ext}.`);
  }
  if (type) {
    if (await fileExists(file)) {
      return {
        type,
        path: path.resolve(file),
      };
    }
  }
}
