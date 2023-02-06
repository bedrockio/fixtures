import mongoose from 'mongoose';

import { camelCase, kebabCase, upperFirst } from 'lodash-es';

export function pluralCamel(str) {
  // Mongoose pluralize is for db collections so will lose camel casing,
  // ie UserProfile -> userprofiles. To achieve the target "userProfiles",
  // first convert to kebab, then pluralize, then back to camel.
  return camelCase(mongoose.pluralize()(kebabCase(str)));
}

export function pluralUpper(str) {
  return upperFirst(pluralCamel(str));
}

export function camelUpper(str) {
  return upperFirst(camelCase(str));
}

export function pluralKebab(str) {
  return mongoose.pluralize()(kebabCase(str));
}

export { kebabCase } from 'lodash-es';
