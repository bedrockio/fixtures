import path from 'path';

import { kebabCase } from 'lodash-es';

import { convertRelativeTime } from './time';

// TODO: figure this out
// import roleDefinitions from '../../roles.json';

export const { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL } = process.env;

export const BASE_DIR = path.join(process.cwd(), 'fixtures');

export const ADMIN_FIXTURE_ID = 'users/admin';
export const ORGANIZATION_FIXTURE_ID = 'organizations/default';

export const CUSTOM_TRANSFORMS = {
  env(key) {
    return process.env[key];
  },
  async ref(key, meta, context) {
    const doc = await context.importFixtures(key, meta);
    return doc.id;
  },
  async obj(key, meta, context) {
    const doc = await context.importFixtures(key, meta);
    return doc.toObject();
  },
  async upload(file, meta, context) {
    const upload = await context.importUpload(file, meta);
    return upload.id;
  },

  rel(key) {
    return convertRelativeTime(key);
  },
};

export const MODEL_TRANSFORMS = {
  User: {
    name(attributes) {
      // Note intentionally not using name defaults as this
      // can mask invalid fixtures which we want to error.
      const { name } = attributes;
      if (name) {
        const [firstName, ...rest] = name.split(' ');
        attributes.firstName = firstName;
        attributes.lastName = rest.join(' ');
        delete attributes.name;
      }
    },
    email(attributes) {
      if (!attributes.email) {
        const { firstName } = attributes;
        const domain = ADMIN_EMAIL.split('@')[1];
        attributes.email = `${kebabCase(firstName)}@${domain}`;
      }
    },
    // async role(attributes, meta, context) {
    //   const { role } = attributes;
    //   if (role) {
    //     const def = roleDefinitions[role];
    //     if (def.allowScopes.includes('global')) {
    //       attributes.roles = [{ role, scope: 'global' }];
    //     } else {
    //       const organization = await context.importFixtures(
    //         ORGANIZATION_FIXTURE_ID,
    //         meta
    //       );
    //       attributes.roles = [
    //         { role, scope: 'organization', scopeRef: organization.id },
    //       ];
    //     }
    //     delete attributes.role;
    //   }
    // },
    password(attributes) {
      if (!attributes.password) {
        attributes.password = ADMIN_PASSWORD;
      }
    },
  },
};
