import path from 'path';

const { BUILD_PATH } = process.env;

export default {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: '16.13.0',
        },
      },
    ],
  ],
  plugins: [
    'lodash',
    ...(BUILD_PATH
      ? [
          [
            'babel-plugin-import-replacement',
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
