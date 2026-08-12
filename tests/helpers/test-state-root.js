const os = require('node:os');
const path = require('node:path');

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function assertDisposableTestRoot(root) {
  if (!root) {
    throw new Error('CAMOFOX_TEST_STATE_ROOT is required before resetting test state');
  }

  const resolved = path.resolve(root);
  const parent = path.dirname(resolved);
  const basename = path.basename(resolved);
  if (!samePath(parent, os.tmpdir()) || !/^camofox-jest-state-[A-Za-z0-9]+$/.test(basename)) {
    throw new Error(`CAMOFOX_TEST_STATE_ROOT is not a disposable Jest temp directory: ${root}`);
  }
  return resolved;
}

module.exports = { assertDisposableTestRoot };
