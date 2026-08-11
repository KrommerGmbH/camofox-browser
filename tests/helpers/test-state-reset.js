const fs = require('node:fs');
const path = require('node:path');

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resetTestStateDirectories(keys) {
  const root = process.env.CAMOFOX_TEST_STATE_ROOT;
  if (!root) {
    throw new Error('CAMOFOX_TEST_STATE_ROOT is required before resetting test state');
  }

  for (const key of keys) {
    const directory = process.env[key];
    if (!directory) continue;
    if (!isWithinRoot(root, directory)) {
      throw new Error(`${key} is outside CAMOFOX_TEST_STATE_ROOT; refusing to delete ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true });
  }
}

module.exports = { resetTestStateDirectories };
