const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertDisposableTestRoot } = require('./test-state-root');

module.exports = async function globalTestStateSetup() {
  const stateRoot = assertDisposableTestRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'camofox-jest-state-')));
  const stateDirs = {
    CAMOFOX_PROFILES_DIR: path.join(stateRoot, 'profiles'),
    CAMOFOX_COOKIES_DIR: path.join(stateRoot, 'cookies'),
    CAMOFOX_DOWNLOADS_DIR: path.join(stateRoot, 'downloads'),
    CAMOFOX_TRACES_DIR: path.join(stateRoot, 'traces'),
  };

  process.env.CAMOFOX_TEST_STATE_ROOT = stateRoot;
  for (const [key, value] of Object.entries(stateDirs)) {
    fs.mkdirSync(value, { recursive: true });
    process.env[key] = value;
  }
};
