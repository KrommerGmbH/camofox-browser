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

    expect(path.basename(profileDirForProfileKey(PROFILES_DIR, defaultProfileKey, 'linux'))).toBe(userId);
  });

  test('hashes default-user profile keys on Windows so case-insensitive names cannot alias', () => {
    const upperKey = `u:${encodeKeyComponent('Alice')}`;
    const lowerKey = `u:${encodeKeyComponent('alice')}`;
    const dottedKey = `u:${encodeKeyComponent('alice.')}`;

    const upperDir = path.basename(profileDirForProfileKey(PROFILES_DIR, upperKey, 'win32'));
    const lowerDir = path.basename(profileDirForProfileKey(PROFILES_DIR, lowerKey, 'win32'));
    const dottedDir = path.basename(profileDirForProfileKey(PROFILES_DIR, dottedKey, 'win32'));

    expect(upperDir).toMatch(/^profile-[0-9a-f]{64}$/);
    expect(lowerDir).toMatch(/^profile-[0-9a-f]{64}$/);
    expect(dottedDir).toMatch(/^profile-[0-9a-f]{64}$/);
    expect(new Set([upperDir, lowerDir, dottedDir]).size).toBe(3);
  });
});
