const fs = require('node:fs');

module.exports = async function globalTestStateTeardown() {
  const stateRoot = process.env.CAMOFOX_TEST_STATE_ROOT;
  if (!stateRoot) return;

  fs.rmSync(stateRoot, { recursive: true, force: true });
};
