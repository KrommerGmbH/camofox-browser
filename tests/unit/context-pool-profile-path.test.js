const path = require('path');

const {
  previousProfileDirForProfileKey,
  profileDirForProfileKey,
  resolveProfileDirForProfileKey,
} = require('../../dist/src/utils/profile-path');

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

  test('keeps a read path to the previous Windows default-user directory format', () => {
    const profileKey = `u:${encodeKeyComponent('existing-user')}`;
    const legacyDir = previousProfileDirForProfileKey(PROFILES_DIR, profileKey, 'win32');
    const currentDir = profileDirForProfileKey(PROFILES_DIR, profileKey, 'win32');

    expect(path.basename(legacyDir)).toBe('existing-user');
    expect(legacyDir).not.toBe(currentDir);
    expect(resolveProfileDirForProfileKey(
      PROFILES_DIR,
      profileKey,
      'win32',
      {
        existsSync: (candidate) => candidate === legacyDir,
        readdirSync: () => [path.basename(legacyDir)],
      },
    )).toBe(legacyDir);
  });

  test('keeps a read path to the previous Windows session-profile directory format', () => {
    const profileKey = `s:${encodeKeyComponent('existing-user')}:${encodeKeyComponent('main')}`;
    const legacyDir = previousProfileDirForProfileKey(PROFILES_DIR, profileKey, 'win32');
    const currentDir = profileDirForProfileKey(PROFILES_DIR, profileKey, 'win32');

    expect(path.basename(legacyDir)).toBe(encodeURIComponent(profileKey));
    expect(legacyDir).not.toBe(currentDir);
    expect(resolveProfileDirForProfileKey(
      PROFILES_DIR,
      profileKey,
      'win32',
      {
        existsSync: (candidate) => candidate === legacyDir,
        readdirSync: () => [path.basename(legacyDir)],
      },
    )).toBe(legacyDir);
  });

  test('uses the hashed Windows directory for new profiles when no legacy state exists', () => {
    const profileKey = `u:${encodeKeyComponent('new-user')}`;
    const currentDir = profileDirForProfileKey(PROFILES_DIR, profileKey, 'win32');

    expect(resolveProfileDirForProfileKey(
      PROFILES_DIR,
      profileKey,
      'win32',
      { existsSync: () => false, readdirSync: () => [] },
    )).toBe(currentDir);
  });

  test('fails closed when both previous and current Windows profile directories exist', () => {
    const profileKey = `u:${encodeKeyComponent('ambiguous-user')}`;

    expect(() => resolveProfileDirForProfileKey(
      PROFILES_DIR,
      profileKey,
      'win32',
      {
        existsSync: () => true,
        readdirSync: () => [path.basename(previousProfileDirForProfileKey(PROFILES_DIR, profileKey, 'win32'))],
      },
    )).toThrow(/both the current and previous Windows profile directories exist/);
  });

  test('fails closed when a Windows-equivalent legacy path has a different exact on-disk name', () => {
    const profileKey = `u:${encodeKeyComponent('Alice')}`;
    const legacyDir = previousProfileDirForProfileKey(PROFILES_DIR, profileKey, 'win32');

    expect(() => resolveProfileDirForProfileKey(
      PROFILES_DIR,
      profileKey,
      'win32',
      {
        existsSync: (candidate) => candidate === legacyDir,
        readdirSync: () => ['alice'],
      },
    )).toThrow(/case or trailing-dot\/space alias/);
  });
});
