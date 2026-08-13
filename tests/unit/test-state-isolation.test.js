const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

describe('Jest runtime-state isolation', () => {
  test('routes persistent test state to a disposable temp root and removes it at teardown', async () => {
    const config = require('../../jest.config');
    const setupPath = path.join(__dirname, '../helpers/global-test-state-setup.js');
    const teardownPath = path.join(__dirname, '../helpers/global-test-state-teardown.js');

    expect(config.globalSetup).toBe('<rootDir>/tests/helpers/global-test-state-setup.js');
    expect(config.globalTeardown).toBe('<rootDir>/tests/helpers/global-test-state-teardown.js');
    expect(fs.existsSync(setupPath)).toBe(true);
    expect(fs.existsSync(teardownPath)).toBe(true);

    const setup = require(setupPath);
    const teardown = require(teardownPath);
    const previousEnv = { ...process.env };

    try {
      await setup();
      const stateRoot = process.env.CAMOFOX_TEST_STATE_ROOT;

      expect(stateRoot).toBeTruthy();
      expect(path.relative(os.tmpdir(), stateRoot).startsWith('..')).toBe(false);
      expect(process.env.CAMOFOX_PROFILES_DIR).toBe(path.join(stateRoot, 'profiles'));
      expect(process.env.CAMOFOX_COOKIES_DIR).toBe(path.join(stateRoot, 'cookies'));
      expect(process.env.CAMOFOX_DOWNLOADS_DIR).toBe(path.join(stateRoot, 'downloads'));
      expect(process.env.CAMOFOX_TRACES_DIR).toBe(path.join(stateRoot, 'traces'));

      fs.mkdirSync(process.env.CAMOFOX_PROFILES_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.CAMOFOX_PROFILES_DIR, 'marker.txt'), 'temporary');

      await teardown();
      expect(fs.existsSync(stateRoot)).toBe(false);
    } finally {
      process.env = previousEnv;
    }
  });
});
