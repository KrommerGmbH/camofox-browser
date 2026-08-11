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

  test('runs package verification npm commands through the same Windows-safe invocation', () => {
    const verifier = fs.readFileSync(
      path.join(__dirname, '../../scripts/verify-package.mjs'),
      'utf8',
    );

    expect(verifier).toContain('process.env.npm_execpath');
    expect(verifier).not.toContain("process.platform === 'win32' ? 'npm.cmd' : 'npm'");
  });

  test('passes the cmd launcher command line verbatim for paths containing spaces', () => {
    const verifier = fs.readFileSync(
      path.join(__dirname, '../../scripts/verify-portable-windows.mjs'),
      'utf8',
    );

    expect(verifier).toContain('windowsVerbatimArguments: true');
  });
});
