describe('Windows VNC guard', () => {
  test('rejects virtual display mode without spawning Unix display processes', async () => {
    jest.resetModules();

    const actualChildProcess = jest.requireActual('node:child_process');
    const spawn = jest.fn(() => {
      throw new Error('unexpected Unix process spawn');
    });
    jest.doMock('node:child_process', () => ({
      ...actualChildProcess,
      spawn,
    }));

    const os = require('node:os');
    const platform = jest.spyOn(os, 'platform').mockReturnValue('win32');

    try {
      const { startVnc } = require('../../dist/src/services/vnc');
      await expect(startVnc('visitor', ':99')).rejects.toThrow(
        'Windows x64 support is headless-only',
      );
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      platform.mockRestore();
      jest.dontMock('node:child_process');
    }
  });
});
