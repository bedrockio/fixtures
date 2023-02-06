process.env.ADMIN_EMAIL = 'foo@bar.com';
process.env.ADMIN_PASSWORD = 'password';
process.env.API_URL = 'http://localhost';

export default {
  preset: '@shelf/jest-mongodb',
  setupFilesAfterEnv: ['<rootDir>/test/setup'],
  // https://github.com/shelfio/jest-mongodb#6-jest-watch-mode-gotcha
  watchPathIgnorePatterns: ['globalConfig'],
};
