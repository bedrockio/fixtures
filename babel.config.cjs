const path = require('path');

const { BUILD_DIR } = process.env;

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
    ...(BUILD_DIR
      ? [
          [
            'import-replacement',
            {
              rules: [
                {
                  match: 'mongoose',
                  replacement: path.resolve(
                    BUILD_DIR,
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
