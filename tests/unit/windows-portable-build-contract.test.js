const fs = require('node:fs');
const path = require('node:path');

describe('Windows portable build process invocation', () => {
  test('runs npm through its JavaScript CLI instead of spawning npm.cmd directly', () => {
    const script = fs.readFileSync(
      path.join(__dirname, '../../scripts/build-portable-windows.mjs'),
      'utf8',
    );

    expect(script).toContain('process.env.npm_execpath');
    expect(script).not.toContain("process.platform === 'win32' ? 'npm.cmd' : 'npm'");
  });
});
