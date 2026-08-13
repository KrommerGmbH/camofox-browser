describe('Windows platform support contract', () => {
  const {
    assertBrowserPlatformSupported,
    assertDisplayModeSupported,
    assertWindowsArchitectureSupported,
    mapHostOS,
  } = require('../../dist/src/utils/platform-support');

  test('maps win32 to the public windows fingerprint OS name', () => {
    expect(mapHostOS('win32')).toBe('windows');
    expect(mapHostOS('darwin')).toBe('macos');
    expect(mapHostOS('linux')).toBe('linux');
  });

  test('supports headless mode on Windows x64 contract', () => {
    expect(() => assertBrowserPlatformSupported('windows', 'x64', true)).not.toThrow();
  });

  test.each(['arm64', 'ia32'])(
    'rejects unsupported Windows architecture %s',
    (architecture) => {
      expect(() => assertWindowsArchitectureSupported('windows', architecture)).toThrow(
        'Windows support currently requires x64',
      );
    },
  );

  test.each(['arm64', 'ia32'])(
    'preserves non-Windows architecture behavior for %s',
    (architecture) => {
      expect(() => assertWindowsArchitectureSupported('linux', architecture)).not.toThrow();
      expect(() => assertWindowsArchitectureSupported('macos', architecture)).not.toThrow();
    },
  );

  test('reports unsupported Windows architecture as a route-safe 400 error', () => {
    try {
      assertBrowserPlatformSupported('windows', 'arm64', true);
      throw new Error('expected Windows architecture rejection');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'UnsupportedPlatformError',
        statusCode: 400,
      });
    }
  });

  test.each([false, 'virtual'])(
    'rejects unsupported Windows display mode %p before Linux-only display services are used',
    (headless) => {
      try {
        assertDisplayModeSupported('windows', headless);
        throw new Error('expected Windows display mode rejection');
      } catch (error) {
        expect(error).toMatchObject({
          name: 'UnsupportedDisplayModeError',
          statusCode: 400,
        });
        expect(error.message).toContain('Windows x64 support is headless-only');
      }
    },
  );

  test.each(['linux', 'macos'])(
    'preserves existing %s display-mode behavior',
    (hostOS) => {
      expect(() => assertDisplayModeSupported(hostOS, true)).not.toThrow();
      expect(() => assertDisplayModeSupported(hostOS, false)).not.toThrow();
      expect(() => assertDisplayModeSupported(hostOS, 'virtual')).not.toThrow();
    },
  );
});
