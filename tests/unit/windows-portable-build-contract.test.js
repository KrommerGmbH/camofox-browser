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

  test('binds the portable artifact to its source revision and verifies its manifest', () => {
    const builder = fs.readFileSync(
      path.join(__dirname, '../../scripts/build-portable-windows.mjs'),
      'utf8',
    );
    const verifier = fs.readFileSync(
      path.join(__dirname, '../../scripts/verify-portable-windows.mjs'),
      'utf8',
    );

    expect(builder).toContain('SOURCE-REVISION.txt');
    expect(builder).toContain('process.env.GITHUB_SHA');
    expect(verifier).toContain('SOURCE-REVISION.txt');
    expect(verifier).toContain('manifest.sha256');
    expect(verifier).toContain('Portable manifest hash mismatch');
  });

  test('bundles the exact upstream Codicon MIT notice redistributed with playwright-core', () => {
    const builder = fs.readFileSync(
      path.join(__dirname, '../../scripts/build-portable-windows.mjs'),
      'utf8',
    );

    expect(builder).toContain('Playwright-VSCode-Codicon-MIT.txt');
    expect(builder).toContain('20535828272932407c2f5172aeb714ac7b374a34e5ecb1825af509f2902cde54');
  });
});
