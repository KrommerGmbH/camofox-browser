const fs = require('node:fs');
const path = require('node:path');
const { assertDisposableTestRoot } = require('./test-state-root');

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resetTestStateDirectories(keys) {
  const root = assertDisposableTestRoot(process.env.CAMOFOX_TEST_STATE_ROOT);

  for (const key of keys) {
    const directory = process.env[key];
    if (!directory) continue;
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) {
      throw new Error(`${key} is a symbolic link; refusing to delete ${directory}`);
    }
    if (!isWithinRoot(root, directory)) {
      throw new Error(`${key} is outside CAMOFOX_TEST_STATE_ROOT; refusing to delete ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true });
  }
}

module.exports = { resetTestStateDirectories };
