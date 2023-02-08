const path = require('path');

const { BUILD_PATH } = process.env;

module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: 'current',
        },
      },
    ],
  ],
  plugins: [
    'lodash',
    ...(BUILD_PATH
      ? [
          [
            'import-replacement',
            {
              rules: [
                {
                  match: 'mongoose',
                  replacement: path.resolve(
                    BUILD_PATH,
                    'node_modules/mongoose'
                  ),
                },
              ],
            },
          ],
        ]
      : []),
  ],
};
