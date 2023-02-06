import { kebabCase } from 'lodash';

import { getOptions } from './options';
import { convertRelativeTime } from './time';

export const customTransforms = {
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

export const modelTransforms = {
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
        const { adminEmail } = getOptions();
        const domain = adminEmail.split('@')[1];
        attributes.email = `${kebabCase(firstName)}@${domain}`;
      }
    },
    async role(attributes, meta, context) {
      const { role } = attributes;
      const { getRoles, organizationFixtureId } = getOptions();
      if (role) {
        const def = getRoles()[role];
        if (def.allowScopes.includes('global')) {
          attributes.roles = [{ role, scope: 'global' }];
        } else {
          const organization = await context.importFixtures(
            organizationFixtureId,
            meta
          );
          attributes.roles = [
            { role, scope: 'organization', scopeRef: organization.id },
          ];
        }
        delete attributes.role;
      }
    },
    password(attributes) {
      if (!attributes.password) {
        attributes.password = getOptions().adminPassword;
      }
    },
  },
};
