import mongoose from 'mongoose';

import { importFixtures, resetFixtures } from '../src/import';
import { setOptions } from '../src/options';

setOptions({
  roles: [],
  createUpload: async (file, options) => {
    const Upload = mongoose.models['Upload'];
    return await Upload.create({
      owner: options.owner,
    });
  },
});

function createModel(name, attributes) {
  return mongoose.model(name, new mongoose.Schema(attributes));
}

createModel('User', {
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
});

createModel('Post', {
  content: 'String',
  nested: {
    nestedContent: 'String',
  },
});

createModel('Upload', {
  owner: {
    type: 'ObjectId',
    ref: 'User',
  },
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
    const fixtures = await importFixtures('users');
    expect(fixtures).toMatchObject({
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
      content: '# Header\n',
      nested: {
        nestedContent: '# Header\n',
      },
    });
  });

  it('should load an es module', async () => {
    const fixtures = await importFixtures('users/jack');
    expect(fixtures).toMatchObject({
      firstName: 'Jack',
      lastName: 'Black',
    });
  });

  it('should load an es module exporting a function', async () => {
    const fixtures = await importFixtures('users/ben');
    expect(fixtures).toMatchObject({
      firstName: 'Ben',
      lastName: 'Maxwell',
    });
  });

  it('should load an index file', async () => {
    const fixtures = await importFixtures('users/james');
    expect(fixtures).toMatchObject({
      firstName: 'James',
      lastName: 'McAvoy',
    });
  });

  it('should not have populated owner for admin', async () => {
    const admin = await importFixtures('users/admin');
    expect(admin.image.owner.image).toBeUndefined();
  });

  it('should not have populated owner for user', async () => {
    const james = await importFixtures('users/james');
    expect(james.image.owner.image).toBeUndefined();
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
});
