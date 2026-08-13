const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { launchServer } = require('../../dist/src/utils/launcher');

describe('server subprocess runtime', () => {
  test('uses the current Node executable even when node is unavailable on PATH', async () => {
    const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camofox-launcher-runtime-'));
    const serverDir = path.join(pluginDir, 'dist', 'src');
    fs.mkdirSync(serverDir, { recursive: true });
    fs.writeFileSync(
      path.join(serverDir, 'server.js'),
      'process.stdout.write(process.execPath);',
      'utf8',
    );

    try {
      const proc = launchServer({
        pluginDir,
        port: 19377,
        env: {
          ...process.env,
          PATH: '',
          Path: '',
        },
      });

      const output = await new Promise((resolve, reject) => {
        let stdout = '';
        proc.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        proc.once('error', reject);
        proc.once('exit', (code, signal) => {
          if (code === 0 && signal === null) resolve(stdout);
          else reject(new Error(`child exited with code=${code} signal=${signal}`));
        });
      });

      expect(path.resolve(output)).toBe(path.resolve(process.execPath));
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
  });
});
