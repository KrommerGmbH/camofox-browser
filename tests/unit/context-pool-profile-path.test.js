const path = require('path');

const { profileDirForProfileKey } = require('../../dist/src/utils/profile-path');

const PROFILES_DIR = path.join(path.sep, 'tmp', 'camofox-test-profiles');

function encodeKeyComponent(value) {
  return Buffer.from(String(value), 'utf16le').toString('base64url');
}

describe('context pool profile directory paths', () => {
  test('bounds internal session-profile directory names for Windows path safety', () => {
    const userId = `profile-drift-${'a'.repeat(36)}`;
    const profileKey = [
      'p',
      encodeKeyComponent(userId),
      encodeKeyComponent('stable'),
      encodeKeyComponent('0123456789ab'),
    ].join(':');

    const profileDir = profileDirForProfileKey(PROFILES_DIR, profileKey, 'win32');
    const basename = path.basename(profileDir);

    expect(encodeURIComponent(profileKey).length).toBeGreaterThan(180);
    expect(basename).toMatch(/^profile-[0-9a-f]{64}$/);
    expect(basename.length).toBe(72);
    expect(profileDirForProfileKey(PROFILES_DIR, profileKey, 'win32')).toBe(profileDir);
  });

  test('preserves legacy internal session-profile directory names off Windows', () => {
    const profileKey = [
      'p',
      encodeKeyComponent('existing-linux-user'),
      encodeKeyComponent('stable'),
      encodeKeyComponent('0123456789ab'),
    ].join(':');

    expect(path.basename(profileDirForProfileKey(PROFILES_DIR, profileKey, 'linux'))).toBe(
      encodeURIComponent(profileKey),
    );
  });

  test('preserves the existing readable directory name for default user profiles', () => {
    const userId = 'visitor';
    const defaultProfileKey = `u:${encodeKeyComponent(userId)}`;

    expect(path.basename(profileDirForProfileKey(PROFILES_DIR, defaultProfileKey))).toBe(userId);
  });
});
