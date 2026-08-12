const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('ServerManager readiness delay', () => {
  test('keeps an awaited readiness delay alive after the daemon child is unrefed', () => {
    const managerPath = path.join(__dirname, '../../dist/src/cli/server/manager.js');
    const script = [
      `const { ServerManager } = require(${JSON.stringify(managerPath)});`,
      'const manager = new ServerManager(19379);',
      "manager.delay(25).then(() => process.stdout.write('ready\\n'));",
    ].join('\n');

    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: 1_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ready');
  });
});
