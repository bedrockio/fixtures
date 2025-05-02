import { createTestModel } from '@bedrockio/model';

import { importFixtures } from '../src/import';
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
  },
});

createTestModel('User', {
  name: 'String',
  firstName: 'String',
  lastName: 'String',
});

describe('User with name', () => {
  it('should not override name if set', async () => {
    const frank = await importFixtures('users/frank');
    expect(frank.name).toBe('Frank Reynolds');
  });
});
