const fs = require('node:fs');
const { assertDisposableTestRoot } = require('./test-state-root');

module.exports = async function globalTestStateTeardown() {
  const stateRoot = process.env.CAMOFOX_TEST_STATE_ROOT;
  if (!stateRoot) return;

  fs.rmSync(assertDisposableTestRoot(stateRoot), { recursive: true, force: true });
};
