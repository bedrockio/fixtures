import { createTestModel } from '@bedrockio/model';
import mongoose from 'mongoose';

import { cloneFixtures } from '../src/clone';
import { importFixtures, resetFixtures } from '../src/import';
import { loadFixtures } from '../src/load';
import { setOptions } from '../src/options';

process.env['ADMIN_EMAIL'] = 'admin@bedrock.io';
process.env['ADMIN_PASSWORD'] = 'password';
process.env['API_URL'] = 'http://localhost';

setOptions({
  roles: {
    admin: {
      allowScopes: ['global'],
      name: 'Admin',
      permissions: {
        shops: 'all',
      },
    },
    viewer: {
      allowScopes: ['organization'],
      name: 'Admin',
      permissions: {
        shops: 'all',
      },
    },
  },
  createUpload: async (file, options) => {
    const Upload = mongoose.models['Upload'];
    return await Upload.create({
      ...options,
    });
  },
});

createTestModel('User', {
  firstName: 'String',
  lastName: 'String',
  email: {
    type: 'String',
    unique: true,
  },
  image: {
    type: 'ObjectId',
    ref: 'Upload',
  },
  profile: 'String',
  roles: [
    {
      role: 'String',
      scope: 'String',
      scopeRef: 'String',
    },
  ],
});

createTestModel('Post', {
  content: 'String',
  nested: {
    nestedContent: 'String',
  },
});

createTestModel('Upload', {
  private: 'Boolean',
  owner: {
    type: 'ObjectId',
    ref: 'User',
  },
});

createTestModel('Organization', {
  name: 'String',
});

createTestModel('Comment', {
  name: 'String',
  subComment: {
    type: 'ObjectId',
    ref: 'Comment',
  },
});

// Models for the cross-path cycle test below. The cycle is:
//   CycleUser.organization <-> CycleOrg.owner
// triggered by a CycleClient that holds parallel refs to both an org
// (loaded via a generated module) and a location whose owner is the same
// user. The two paths converge on the user via meta chains that don't
// include each other, so the chain-walk cycle detector cannot see it
// from either side; only the in-flight check in importFixturesWithGuard
// breaks the deadlock.
createTestModel('CycleOrg', {
  name: 'String',
  owner: {
    type: 'ObjectId',
    ref: 'CycleUser',
  },
});

createTestModel('CycleUser', {
  email: {
    type: 'String',
    unique: true,
  },
  organization: {
    type: 'ObjectId',
    ref: 'CycleOrg',
  },
});

createTestModel('CycleLocation', {
  name: 'String',
  owner: {
    type: 'ObjectId',
    ref: 'CycleUser',
  },
});

createTestModel('CycleClient', {
  name: 'String',
  organization: {
    type: 'ObjectId',
    ref: 'CycleOrg',
  },
  location: {
    type: 'ObjectId',
    ref: 'CycleLocation',
  },
});

// Runs before any other test that calls resetFixtures() — once the cycle
// fixtures are loaded into the DB, later tests that clear the memoize cache
// won't try to re-create them.
describe('cross-path circular references', () => {
  it(
    'should resolve when concurrent sibling refs converge on a cycle endpoint',
    async () => {
      // CycleClient triggers two concurrent paths via Promise.all in
      // transformAttributes:
      //   - organization → cycle-orgs/acme (via the generated index.json)
      //   - location → cycle-locations/hq → owner: alice
      // Both paths converge on cycle-users/alice, whose `organization`
      // ref points back at acme. Without the in-flight check, the two
      // memoized loads await each other and deadlock — the chain-walk
      // detector misses the cycle because each path's meta chain only
      // contains its own ancestors, not the other path's.
      const c1 = await importFixtures('cycle-clients/c1');
      expect(c1.name).toBe('C1');

      const acme = await importFixtures('cycle-orgs/acme');
      const alice = await importFixtures('cycle-users/alice');
      const hq = await importFixtures('cycle-locations/hq');

      // Refs may be populated docs or bare ObjectIds (when resolved via
      // a placeholder). Normalize to the id string for comparison.
      const idOf = (x) => (x?._id || x).toString();

      expect(idOf(c1.organization)).toBe(acme.id);
      expect(idOf(c1.location)).toBe(hq.id);

      // Cycle endpoints must resolve to the real ids, not leftover
      // placeholder ObjectIds.
      expect(idOf(acme.owner)).toBe(alice.id);
      expect(idOf(alice.organization)).toBe(acme.id);
      expect(idOf(hq.owner)).toBe(alice.id);
    },
    5000,
  );
});

describe('importFixtures', () => {
  it('should load root fixtures', async () => {
    const fixtures = await importFixtures();
    expect(fixtures).toMatchObject({
      users: {
        admin: {
          firstName: 'Marlon',
          lastName: 'Brando',
        },
      },
      'users/admin': {
        firstName: 'Marlon',
        lastName: 'Brando',
      },
    });
  });

  it('should load directory fixtures', async () => {
    const users = await importFixtures('users');
    expect(users).toMatchObject({
      admin: {
        firstName: 'Marlon',
        lastName: 'Brando',
      },
    });
  });

  it('should load single fixture', async () => {
    const admin = await importFixtures('users/admin');
    expect(admin).toMatchObject({
      firstName: 'Marlon',
      lastName: 'Brando',
    });
  });

  it('should not be serialized', async () => {
    const admin = await importFixtures('users/admin');
    expect(admin.save).toBeInstanceOf(Function);
  });

  it('should import content files', async () => {
    const post = await importFixtures('posts/post');
    expect(post).toMatchObject({
      content: '# Header',
      nested: {
        nestedContent: '# Header',
      },
    });
  });

  it('should not interpret external URL as file', async () => {
    const jack = await importFixtures('users/jack');
    expect(jack.profile).toBe(
      'My profile image: https://example.com/path/to/image.jpg',
    );
  });

  it('should load an es module', async () => {
    const jack = await importFixtures('users/jack');
    expect(jack).toMatchObject({
      firstName: 'Jack',
      lastName: 'Black',
    });
  });

  it('should load an es module exporting a function', async () => {
    const ben = await importFixtures('users/ben');
    expect(ben).toMatchObject({
      firstName: 'Ben',
      lastName: 'Maxwell',
    });
  });

  it('should load an index file', async () => {
    const james = await importFixtures('users/james');
    expect(james).toMatchObject({
      firstName: 'James',
      lastName: 'McAvoy',
    });
  });

  it('should not have populated owner for admin', async () => {
    const admin = await importFixtures('users/admin');
    expect(admin.image.owner.image).toBeUndefined();
    expect(admin.roles).toMatchObject([
      {
        role: 'admin',
        scope: 'global',
      },
    ]);
  });

  it('should not have populated owner for user', async () => {
    const james = await importFixtures('users/james');
    expect(james.image.owner.image).toBeUndefined();
  });

  it('should import undefined roles as global', async () => {
    const charles = await importFixtures('users/charles');
    expect(charles.roles).toMatchObject([
      {
        role: 'member',
        scope: 'global',
      },
    ]);
  });

  it('should import roles with organization scopes', async () => {
    const victor = await importFixtures('users/victor');
    const organization = await importFixtures('organizations/default');
    expect(victor.roles).toMatchObject([
      {
        role: 'viewer',
        scope: 'organization',
        scopeRef: organization.id,
      },
    ]);
  });

  it('should not fail on unique constraint if user exists', async () => {
    const { User } = mongoose.models;
    resetFixtures();
    await User.deleteMany();
    const admin = await User.create({
      firstName: 'Marlon',
      lastName: 'Brando',
      email: 'admin@bedrock.io',
    });
    const james = await importFixtures('users/james');
    expect(james.image.owner.toString()).toEqual(admin.id);

    await User.deleteOne({
      email: 'admin@bedrock.io',
    });
  });

  it('should resolve recursive comment fixtures', async () => {
    const comments = await importFixtures('comments');
    const first = comments['Comment 1'];
    expect(first.subComment).toEqual(first._id);
  });

  it('should have private image', async () => {
    const dennis = await importFixtures('users/dennis');
    expect(dennis.image.private).toBe(true);
  });
});

describe('cloneFixtures', () => {
  it('should clone single fixture', async () => {
    const user = await importFixtures('users/james');
    const clone = await cloneFixtures('users/james');
    expect(clone.id).not.toBe(user.id);

    // Unique email is modified.
    expect(clone.email).not.toBe(user.email);
    expect(clone.firstName).toBe(user.firstName);
    expect(clone.lastName).toBe(user.lastName);
  });

  it('should clone fixture collection', async () => {
    const users = await importFixtures('users');
    const clones = await cloneFixtures('users');
    expect(Object.keys(users)).toEqual(Object.keys(clones));

    const user = users['james'];
    const clone = clones['james'];
    expect(clone.id).not.toBe(user.id);

    // Unique email is modified.
    expect(clone.email).not.toBe(user.email);
    expect(clone.firstName).toBe(user.firstName);
    expect(clone.lastName).toBe(user.lastName);
  });
});

describe('loadFixtures', () => {
  it('should not load fixtures if admin user has been deleted', async () => {
    const { User } = mongoose.models;

    await User.destroyMany({
      firstName: 'Jack',
    });

    const admin = await importFixtures('users/admin');
    await admin.delete();

    await loadFixtures();

    const jack = await User.findOne({
      firstName: 'Jack',
    });
    expect(jack).toBe(null);
  });
});
