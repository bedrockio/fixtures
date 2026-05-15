import fs from 'fs/promises';
import path from 'path';

import logger from '@bedrockio/logger';
import { glob } from 'glob';

import {
  camelCase,
  cloneDeep,
  get,
  kebabCase,
  mapKeys,
  memoize,
} from 'lodash-es';

import mongoose from 'mongoose';

import { requireEnv } from './env';
import { resolveFile } from './file';
import { getBaseDir, getOption } from './options';
import { customTransforms, modelTransforms } from './transforms';
import { pluralCamel, pluralKebab, stringReplaceAsync } from './utils';

const { models } = mongoose;

export async function importFixtures(id = '', meta) {
  const { base, name } = getIdComponents(id);
  if (!base) {
    return await importRoot(meta);
  }
  if (name) {
    return await importFixture(id, meta);
  } else {
    return await importDirectory(id, meta);
  }
}

async function importRoot(meta) {
  const bases = await getModelSubdirectories();
  return await buildFixtures(bases, async (base) => {
    const set = await importFixtures(base, meta);
    return {
      [base]: set,
      ...mapKeys(set, (doc, name) => {
        return join(base, name);
      }),
    };
  });
}

async function importDirectory(id, meta) {
  const generated = await getGeneratedFixtures(id, 'imported', meta);
  if (generated) {
    return generated;
  }
  const base = getIdBase(id);
  const names = await loadDirectoryFixtures(base);

  return await buildFixtures(names, async (name) => {
    return {
      [name]: await importFixtures(join(base, name), meta),
    };
  });
}

async function importFixture(id, meta) {
  try {
    const generated = await getGeneratedFixtures(id, 'imported', meta);
    if (generated) {
      return generated;
    }

    // Imported attributes will be mutated, so clone here.
    const attributes = cloneDeep(await loadModule(id));

    if (Array.isArray(attributes)) {
      const base = getIdBase(id);
      const generateFixtureId = getFixtureIdGenerator(base);
      const docs = [];
      for (let obj of attributes) {
        const id = join(base, generateFixtureId());
        const doc = await runImport(id, obj, meta);
        docs.push(doc);
      }
      return docs;
    } else if (attributes) {
      return await runImport(id, attributes, meta);
    } else {
      throw new Error(`No fixture found: "${id}".`);
    }
  } catch (error) {
    const sup = meta ? ` (imported from "${getMetaChain(meta)}")` : '';
    logger.error(`Bad fixture or reference: "${id}"${sup}`);
    throw error;
  }
}

async function runImport(id, attributes, meta) {
  const [root] = id.split(path.sep);
  const model = getModelByName(root);
  meta = { id, model, meta, base: attributes };
  if (isUserImport(id)) {
    return await findOrCreateUser(id, attributes, meta);
  } else {
    return await createDocument(id, attributes, meta);
  }
}

// Document creation

const createDocument = memoize(async (id, attributes, meta) => {
  logger.debug(`Importing: ${id}`);
  inFlightIds.add(id);

  try {
    // Create the document
    await transformAttributes(attributes, meta);
    await applyModelTransforms(attributes, meta);

    const doc = new meta.model(attributes);
    createdDocumentIds.add(doc.id);
    await doc.save();

    // Post import phase
    setDocumentForPlaceholder(doc, meta.id);
    await resolvePlaceholders();
    queuePlaceholderResolve(doc);

    logger.debug(`Finished import: ${id}`);
    pushStat('fixtures', id);
    return doc;
  } finally {
    inFlightIds.delete(id);
  }
});

function isUserImport(id) {
  return id.split('/')[0] === 'users';
}

const findOrCreateUser = memoize(async (id, attributes, meta) => {
  inFlightIds.add(id);

  try {
    const { User } = mongoose.models;

    let user;

    if (User && attributes.email) {
      await transformAttributes(attributes, meta);
      await applyModelTransforms(attributes, meta);

      user = await User.findOne({
        email: attributes.email,
      });
    }

    if (!user) {
      user = await await createDocument(id, attributes, meta);
    }

    return user;
  } finally {
    inFlightIds.delete(id);
  }
});

// Property transform helpers.

async function transformAttributes(attributes, meta) {
  await Promise.all(
    Object.entries(attributes).map(async ([key, value]) => {
      attributes[key] = await transformProperty([key], value, meta);
    }),
  );
}

// Note that "keys" is the property path as an array.
// The naming is only to not shadow "path".
async function transformProperty(keys, value, meta) {
  // ObjectIds resolved on a prior pass shouldn't be recursed into — their
  // internal `buffer` would be walked needlessly. Also acts as a safety net
  // for the Mongoose Document case.
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  const isObject = value === Object(value);
  if (!isKnownField(keys, meta)) {
    // If the field is not known it might be inlined data referenced
    // elsewhere, however this is typically an array or object, so if
    // the value is a primitive it is likely bad data.
    if (!isObject) {
      logBadFixtureField(keys, value, meta);
    }
  } else if (isObject) {
    // Iterate over both arrays and objects transforming them.
    await Promise.all(
      Object.entries(value).map(async ([k, v]) => {
        // Keys in mixed object structures may sometimes also
        // contain references that must be transformed to
        // ObjectIds. for example:
        //
        // "map": {
        //   "user-1": "user-2"
        // }
        //

        if (CUSTOM_TRANSFORM_REG.test(k)) {
          const resolved = await transformCustom(k, meta);
          delete value[k];
          k = resolved;
        }
        value[k] = await transformProperty([...keys, k], v, meta);
      }),
    );
  } else if (await isLocalFile(value, meta)) {
    value = await transformFile(keys, value, meta);
  } else if (CUSTOM_TRANSFORM_REG.test(value)) {
    value = await transformCustom(value, meta);
  } else if (isReferenceField(keys, meta)) {
    value = await transformReference(keys, value, meta);
  }
  return value;
}

// File transform helpers

const FILE_REG =
  /\.(jpg|png|svg|gif|webp|avif|ogg|mp3|mp4|md|txt|html|pdf|csv)$/;
const INLINE_CONTENT_REG =
  /(\(|")([^)"\n]+?\.(?:jpg|png|svg|gif|avif|webp|pdf))([)"])/g;
const INLINE_CONTENT_TYPES_REG = /\.(md|html)$/;

async function transformFile(keys, value, meta) {
  if (isReferenceField(keys, meta)) {
    value = await importUpload(value, meta);
  } else if (isBufferField(keys, meta)) {
    value = await importBuffer(value, meta);
  } else {
    value = await importContent(value, meta);
  }
  return value;
}

async function isLocalFile(value) {
  if (
    typeof value !== 'string' ||
    // Anything with a protocol on it is NOT a local file.
    value.includes('://') ||
    value.includes('\n')
  ) {
    return false;
  }

  return FILE_REG.test(value);
}

// Note that the same content file may be imported
// in different contexts in generator modules, so this
// function cannot be memoized.
async function importContent(file, meta) {
  file = await resolveRelativeFile(file, meta);
  return await importContentOnce(file, meta);
}

const importContentOnce = memoize(async (file, meta) => {
  let content = await fs.readFile(file, 'utf8');
  if (INLINE_CONTENT_TYPES_REG.test(file)) {
    content = await inlineContentFiles(content, meta);
  }
  return content;
});

async function inlineContentFiles(content, meta) {
  const apiUrl = requireEnv('API_URL');
  return await stringReplaceAsync(
    content,
    INLINE_CONTENT_REG,
    async (all, open, file, close) => {
      const upload = await importUpload(file, meta);
      const url = `${apiUrl}/1/uploads/${upload.id}/raw`;
      return `${open}${url}${close}`;
    },
  );
}

async function importBuffer(file, meta) {
  file = await resolveRelativeFile(file, meta);
  return await importBufferOnce(file, meta);
}

const importBufferOnce = memoize(async (file) => {
  return await fs.readFile(file);
});

// Model transform helpers

async function applyModelTransforms(attributes, meta) {
  const transforms = modelTransforms[meta.model.modelName] || {};
  await Promise.all(
    Object.values(transforms).map(async (fn) => {
      return await fn(attributes, meta, {
        importFixtures,
      });
    }),
  );
}

// Custom transform helpers

const CUSTOM_TRANSFORM_REG = /^<(?<func>\w+):(?<token>.+)>$/;

async function transformCustom(value, meta) {
  const { func, token } = value.match(CUSTOM_TRANSFORM_REG).groups;
  const transform = customTransforms[func];
  if (!transform) {
    throw new Error(`Custom transform "${func}" not recognized.`);
  }
  return await transform(token, meta, {
    importUpload,
    importFixtures,
  });
}

// Upload helpers

// For now uploads are not listed out in fixtures directories like
// the other models, so this creates a pseudo fixture with the id
// set to the file path.
async function importUpload(file, meta) {
  file = await resolveRelativeFile(file, meta);
  return await importUploadOnce(file, meta);
}

const importUploadOnce = memoize(
  async (filepath, meta) => {
    const adminFixtureId = getOption('adminFixtureId');

    let owner;
    if (meta.id === adminFixtureId) {
      // As a special case to bootstrap the admin user, set a placeholder
      // to sidestep the circular reference user.profileImage -> image.owner -> user.
      owner = getReferencedPlaceholder(adminFixtureId);
    } else {
      // All other images will be owned by the admin user for now.
      // This field MUST be set to an id to avoid a circular reference.
      const admin = await importFixtures(adminFixtureId, {
        id: filepath,
        meta,
      });
      owner = admin.id;
    }

    const createUpload = getOption('createUpload');
    const filename = path.basename(filepath);

    const file = {
      filename,
      filepath,
    };

    const attributes = {
      owner,
      private: filename.includes('private'),
    };

    const upload = await createUpload(file, attributes);

    queuePlaceholderResolve(upload);
    return upload;
  },
  (file, meta) => {
    return file + meta.id;
  },
);

// Generated modules may cross-reference other fixtures, in which
// case relative file paths will be one level up, so test both directories.
async function resolveRelativeFile(file, meta) {
  if (await fileExists(path.resolve(getBaseDir(), meta.id, file))) {
    return path.resolve(getBaseDir(), meta.id, file);
  } else {
    return path.resolve(getBaseDir(), meta.id, '..', file);
  }
}

// Field helpers

function isReferenceField(keys, meta) {
  const schemaType = getSchemaType(keys, meta);
  return schemaType instanceof mongoose.Schema.Types.ObjectId;
}

function isBufferField(keys, meta) {
  const schemaType = getSchemaType(keys, meta);
  return schemaType instanceof mongoose.Schema.Types.Buffer;
}

// A "known" field is either defined in the schema or
// a custom field that will later be transformed.
function isKnownField(keys, meta) {
  if (isKnownTransform(keys, meta)) {
    return true;
  } else {
    const pathType = meta.model.schema.pathType(keys[0]);
    // Calling "path" on the schema will not return anything
    // for nested fields, so instead use "pathType".
    return pathType === 'real' || pathType === 'nested';
  }
}

function isKnownTransform(keys, meta) {
  const transforms = modelTransforms[meta.model.modelName];
  return !!transforms && keys.join('.') in transforms;
}

async function transformReference(keys, value, meta) {
  // Reference fields may have already resolved, in which
  // case they will be an ObjectId so simply return it.
  if (typeof value !== 'string') {
    return value;
  }
  const model = getReferenceModel(keys, meta);
  const id = join(pluralKebab(model.modelName), value);
  const result = await importFixturesWithGuard(id, meta);
  // Cycle path returns a placeholder ObjectId; normal path returns a
  // Document. Always hand back an ObjectId so attributes stay primitive —
  // otherwise Mongoose treats the Document as a populated ref and later
  // `doc.get(path)` returns a Document instead of the id.
  return result instanceof mongoose.Document ? result._id : result;
}

function getReferenceModel(keys, meta) {
  const schemaType = getSchemaType(keys, meta);
  let { ref, refPath } = schemaType.options;
  if (!ref && refPath) {
    ref = get(meta.base, refPath);
  }
  const model = models[ref];
  if (!model) {
    throw new Error(`Unknown model ${ref}.`);
  }
  return model;
}

function getSchemaType(keys, meta) {
  return meta.model.schema.path(keys.join('.'));
}

// Fixtures with circular references will hang importing
// so guard against this and fall back to placeholders.
// Warn when this is due to circular references in the
// graph as this is not ideal, however it also may happen
// with recursive references in generated modules which
// are resolved as a whole.
async function importFixturesWithGuard(id, meta) {
  try {
    checkGeneratedConflict(id, meta);
    checkCircularReferences(id, meta);
    // checkCircularReferences walks the meta chain, but cycles can also form
    // across concurrent sibling paths whose chains don't include each other
    // (e.g. parallel branches of a Promise.all in transformAttributes that
    // converge on the same fixture from two directions). When that happens,
    // both paths await each other's in-flight load and deadlock. Detect this
    // by checking whether the target is currently in-flight from any path,
    // and fall back to the existing placeholder mechanism if so.
    if (inFlightIds.has(id)) {
      // The cycle itself goes through the in-flight load on another path;
      // this trace just shows where our caller got stuck.
      throw new CircularReferenceError([...getMetaChainIds(meta), id]);
    }
    return await importFixtures(id, meta);
  } catch (err) {
    if (err instanceof CircularReferenceError) {
      logCircularReference(err.toString());
      return getReferencedPlaceholder(id);
    } else if (err instanceof GeneratedConflictError) {
      logger.debug(`Generated conflict in ${id}. Falling back to placeholder.`);
      return getReferencedPlaceholder(id);
    } else {
      throw err;
    }
  }
}

// Circular reference helpers

class CircularReferenceError extends Error {
  constructor(ids) {
    super();
    this.ids = ids;
  }

  toString() {
    return this.ids.join(' -> ');
  }
}

function checkCircularReferences(id, meta) {
  const chain = getMetaChainIds(meta);
  const matchIdx = chain.indexOf(id);
  if (matchIdx !== -1) {
    throw new CircularReferenceError([...chain.slice(matchIdx), id]);
  }
}

function getMetaChain(meta) {
  const chain = [];
  while (meta) {
    chain.push(meta.id);
    meta = meta.meta;
  }

  return chain.reverse().join(' -> ');
}

// Walks the meta chain root-to-leaf returning fixture ids only (skipping
// boundary entries like the {generated} marker that have no id).
function getMetaChainIds(meta) {
  const ids = [];
  while (meta) {
    if (meta.id) {
      ids.unshift(meta.id);
    }
    meta = meta.meta;
  }
  return ids;
}

// Memoize these messages to prevent multiple logs
// for the same reference when importing recursively.

const logBadFixtureField = memoize(
  (keys, value, meta) => {
    const prop = keys.join('.');
    const str = JSON.stringify(value);
    logger.warn(`Possible bad data in ${meta.id} -> "${prop}": ${str}`);
  },
  (keys, value, meta) => {
    // Memoize per fixture, path, and value;
    return meta.id + keys.join('.') + value;
  },
);

const logCircularReference = memoize((message) => {
  if (getOption('warnCircularReferences')) {
    logger.warn('Circular reference detected:', message);
  }
  pushStat('circular', message);
});

// Generated module helpers.

async function getGeneratedFixtures(id, type, parentMeta) {
  const { base, name } = getIdComponents(id);
  const generated = await importGeneratedFixtures(base, parentMeta);
  if (generated) {
    let fixtures = generated[type];
    if (name) {
      fixtures = fixtures[name];
      if (!fixtures) {
        throw new Error(
          `Could not import ${join(
            base,
            name,
          )} from generated directory ${base}.`,
        );
      }
    }
    return fixtures;
  }
}

// Memoized on `base` only — concurrent callers share the in-flight promise.
// `parentMeta` from the first caller is propagated into the inner imports so
// that checkCircularReferences can walk the full chain across the boundary.
const importGeneratedFixtures = memoize(async (base, parentMeta) => {
  let loaded, imported;
  const generateFixtureId = getFixtureIdGenerator(base);
  try {
    loaded = await loadModule(base, {
      generateFixtureId,
      loadFixtureModules,
    });
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      logger.debug(`No generated module found for ${base}`);
      return;
    } else {
      throw err;
    }
  }
  if (loaded) {
    pushStat('modules', base);
    if (Array.isArray(loaded)) {
      loaded = mapKeys(loaded, generateFixtureId);
    }
    const meta = { generated: base, meta: parentMeta };

    // Imported attributes will be mutated, so do a deep clone
    // to ensure that loaded fixtures will be unchanged. This allows
    // generated fixtures to reference others and retain the fixture
    // references exported by the generated module.
    imported = cloneDeep(loaded);

    imported = await buildFixtures(
      Object.entries(imported),
      async ([name, attributes]) => {
        return {
          [name]: await runImport(join(base, name), attributes, meta),
        };
      },
    );
    return {
      loaded,
      imported,
    };
  }
});

class GeneratedConflictError extends Error {}

// Generated modules may contain recursive references.
// If they do we need to throw an error to allow a fallback.
function checkGeneratedConflict(id, meta) {
  const base = getIdBase(id);
  const context = getGeneratedContext(meta);
  if (context === base) {
    throw new GeneratedConflictError();
  }
}

function getGeneratedContext(meta) {
  while (meta) {
    if (meta.generated) {
      return meta.generated;
    }
    meta = meta.meta;
  }
}

// Allow generators to load raw modules to reference them.
async function loadFixtureModules(id) {
  const base = getIdBase();
  const generated = await getGeneratedFixtures(id, 'loaded');
  if (generated) {
    return generated;
  }
  const names = await loadDirectoryFixtures(base);
  return await buildFixtures(names, async (name) => {
    return {
      [name]: await loadModule(join(base, name)),
    };
  });
}

// Auto-increment generator for base.
function getFixtureIdGenerator(base) {
  const singular = kebabCase(getModelByName(base).modelName);
  let counter = 0;
  return () => {
    return `${singular}-${++counter}`;
  };
}

// Placeholder helpers

export let documentsByPlaceholder = new Map();
export let referencedPlaceholders = new Map();
export let unresolvedDocuments = new Set();
export let createdDocumentIds = new Set();
const inFlightIds = new Set();

function queuePlaceholderResolve(doc) {
  if (getDocumentPlaceholders(doc).length > 0) {
    unresolvedDocuments.add(doc);
  }
}

async function resolvePlaceholders() {
  await Promise.all(
    Array.from(unresolvedDocuments).map(async (doc) => {
      let update;
      let hasUnresolved = false;
      for (const [placeholder, path] of getDocumentPlaceholders(doc)) {
        const resolved = getDocumentForPlaceholder(placeholder);
        if (resolved) {
          update ||= {};
          update[path] = resolved.id;
        } else {
          hasUnresolved = true;
        }
      }
      if (update) {
        // Bypass save hooks — bedrock's autoclean test pattern reacts badly
        // to them when documents reference each other.
        await doc.updateOne({ $set: update });
        doc.set(update);
      }
      // Keep the doc queued if anything is still unresolved; the target
      // fixture may save on a later pass and register itself.
      if (!hasUnresolved) {
        unresolvedDocuments.delete(doc);
      }
    }),
  );
}

// Walk every ObjectId path on the document — including paths inside
// embedded subdocs and document arrays — and collect the ones currently
// holding a placeholder ObjectId.
function getDocumentPlaceholders(doc) {
  const placeholders = [];
  visit(doc.schema, doc, []);
  return placeholders;

  function visit(schema, parent, segments) {
    schema.eachPath((name, schemaType) => {
      const value = parent.get(name);
      if (value == null) {
        return;
      }
      const path = [...segments, name];
      if (schemaType instanceof mongoose.Schema.Types.ObjectId) {
        if (isReferencedPlaceholder(value)) {
          placeholders.push([value, path.join('.')]);
        }
      } else if (schemaType.schema) {
        // DocumentArray → iterate elements with indices in the path so the
        // resolver can $set positionally (e.g. `roles.0.scopeRef`).
        // SingleNested → recurse into the single subdoc.
        if (Array.isArray(value)) {
          value.forEach((sub, idx) => {
            visit(schemaType.schema, sub, [...path, idx]);
          });
        } else {
          visit(schemaType.schema, value, path);
        }
      }
    });
  }
}

function getDocumentForPlaceholder(placeholder) {
  return documentsByPlaceholder.get(placeholder.toString());
}

function setDocumentForPlaceholder(doc, id) {
  documentsByPlaceholder.set(getPlaceholderForId(id).toString(), doc);
}

function getReferencedPlaceholder(id) {
  const placeholder = getPlaceholderForId(id);
  referencedPlaceholders.set(placeholder.toString(), id);
  return placeholder;
}

function isReferencedPlaceholder(objectId) {
  return referencedPlaceholders.has(objectId?.toString());
}

// One stable placeholder ObjectId per fixture id — lodash.memoize keys on
// the first argument.
const getPlaceholderForId = memoize(() => new mongoose.Types.ObjectId());

function cleanupPlaceholders() {
  documentsByPlaceholder = new Map();
  referencedPlaceholders = new Map();
  createdDocumentIds = new Set();
  unresolvedDocuments = new Set();
  inFlightIds.clear();
  getPlaceholderForId.cache.clear();
}

// Module helpers

// If the default export of a resolved module is a function then call
// it asynchronously. Memoize as the function may have side effects.
const loadModule = memoize(async (id, args) => {
  const resolved = await resolveFile(path.join(getBaseDir(), id));

  if (resolved) {
    logger.debug(`Loading ${resolved.path}`);

    if (resolved.type === 'json') {
      return JSON.parse(await fs.readFile(resolved.path, 'utf8'));
    } else {
      let module = await import(resolved.path);
      module = module.default;
      if (typeof module === 'function') {
        module = await module(args);
      }
      return module;
    }
  }
});

// Model helpers

// Defer this in case file is required
// before models are loaded.
const getModelsByName = memoize(() => {
  const modelsByName = {};

  for (let [name, model] of Object.entries(models)) {
    Object.assign(modelsByName, {
      // For mapping singular properties.
      // ie. user or userProfile
      [camelCase(name)]: model,
      // For mapping pluralized properties.
      // ie. users or userProfiles
      [pluralCamel(name)]: model,
      // For mapping directories.
      // ie. users or user-profiles
      [pluralKebab(name)]: model,
    });
  }
  return modelsByName;
});

function getModelByName(name, assert = true) {
  const model = getModelsByName()[name];
  if (!model && assert) {
    throw new Error(`Could not find model "${name}".`);
  }
  return model;
}

// File system helpers

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function getModelSubdirectories() {
  const entries = await fs.readdir(getBaseDir(), { withFileTypes: true });
  return entries
    .filter((entry) => {
      return entry.isDirectory() && getModelByName(entry.name, false);
    })
    .map((entry) => {
      return entry.name;
    });
}

// Note: must return fixtures names without file extension:
// ie. users/admin not users/admin.json
async function loadDirectoryFixtures(dir) {
  dir = path.resolve(getBaseDir(), dir);
  const gl = path.resolve(dir, '**/*.{json,js}');
  const files = await glob(gl);
  return files.map((file) => {
    file = path.relative(dir, file);
    let dirname = path.dirname(file);
    let basename = path.basename(file);
    basename = path.basename(basename, '.js');
    basename = path.basename(basename, '.json');
    if (basename === 'index') {
      return dirname;
    } else {
      return path.join(dirname, basename);
    }
  });
}

// Fixture id helpers

function join(base, name) {
  return [base, name].join('/');
}

function getIdComponents(id) {
  const [base, ...rest] = id.split('/');
  const name = rest.join('/');
  return { base, name };
}

function getIdBase(id) {
  return getIdComponents(id).base;
}

// Cleanup helpers

// Remove references that may be
// holding large amounts of memory.
export function resetFixtures() {
  cleanupPlaceholders();
  createDocument.cache.clear();
  findOrCreateUser.cache.clear();
  importGeneratedFixtures.cache.clear();
  importUploadOnce.cache.clear();
  importBufferOnce.cache.clear();
  importContentOnce.cache.clear();
  logBadFixtureField.cache.clear();
  logCircularReference.cache.clear();
  loadModule.cache.clear();
}

// Utils

async function buildFixtures(arr, fn) {
  const fixtures = {};
  for (let el of arr) {
    Object.assign(fixtures, await fn(el));
  }
  await resolvePlaceholders();
  return fixtures;
}

export function isFixture(doc) {
  return createdDocumentIds.has(doc.id);
}

// Stats

let stats;

export function logStats() {
  logger.info();
  logger.info('  ------------- Import Stats ---------------');
  logger.info();
  logger.info(formatStat(stats.fixtures.length, 'fixture', 'imported'));
  formatStatBlock('  Custom modules found:', stats.modules);
  if (getOption('warnCircularReferences')) {
    formatStatBlock('  Circular references found:', stats.circular);
  }
  if (getOption('showPlaceholders')) {
    formatStatBlock('  Referenced placeholders:', referencedPlaceholders);
  }
  logger.info();
  logger.info('------------------------------------------');
  logger.info();
}

export function resetStats() {
  stats = {
    fixtures: [],
    modules: [],
    circular: [],
  };
}

function pushStat(type, value) {
  if (stats) {
    stats[type].push(value);
  }
}

function formatStat(num, unit, msg) {
  return `  ${num} ${num === 1 ? unit : pluralCamel(unit)} ${msg}`;
}

function formatStatBlock(msg, collection) {
  const isMap = collection instanceof Map;
  if (isMap ? collection.size : collection.length) {
    logger.info();
    logger.info(msg);
    for (let entry of collection) {
      logger.info(' ', isMap ? `${entry[0]} -> ${entry[1]}` : entry);
    }
  }
}
