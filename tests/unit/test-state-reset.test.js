const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

describe('test-state incremental reset', () => {
  test('clears disposable state directories and recreates them empty', () => {
    const { resetTestStateDirectories } = require('../helpers/test-state-reset');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camofox-jest-state-'));
    const profiles = path.join(root, 'profiles');
    const downloads = path.join(root, 'downloads');

    fs.mkdirSync(profiles, { recursive: true });
    fs.mkdirSync(downloads, { recursive: true });
    fs.writeFileSync(path.join(profiles, 'profile.txt'), 'temporary');
    fs.writeFileSync(path.join(downloads, 'download.txt'), 'temporary');

    const previous = {
      CAMOFOX_TEST_STATE_ROOT: process.env.CAMOFOX_TEST_STATE_ROOT,
      CAMOFOX_PROFILES_DIR: process.env.CAMOFOX_PROFILES_DIR,
      CAMOFOX_DOWNLOADS_DIR: process.env.CAMOFOX_DOWNLOADS_DIR,
    };

    try {
      process.env.CAMOFOX_TEST_STATE_ROOT = root;
      process.env.CAMOFOX_PROFILES_DIR = profiles;
      process.env.CAMOFOX_DOWNLOADS_DIR = downloads;

      resetTestStateDirectories(['CAMOFOX_PROFILES_DIR', 'CAMOFOX_DOWNLOADS_DIR']);

      expect(fs.readdirSync(profiles)).toEqual([]);
      expect(fs.readdirSync(downloads)).toEqual([]);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('refuses to delete a directory outside the disposable test root', () => {
    const { resetTestStateDirectories } = require('../helpers/test-state-reset');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camofox-jest-state-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'camofox-reset-outside-'));
    const marker = path.join(outside, 'keep.txt');
    fs.writeFileSync(marker, 'keep');

    const previousRoot = process.env.CAMOFOX_TEST_STATE_ROOT;
    const previousProfiles = process.env.CAMOFOX_PROFILES_DIR;
    try {
      process.env.CAMOFOX_TEST_STATE_ROOT = root;
      process.env.CAMOFOX_PROFILES_DIR = outside;

      expect(() => resetTestStateDirectories(['CAMOFOX_PROFILES_DIR'])).toThrow(
        'CAMOFOX_PROFILES_DIR is outside CAMOFOX_TEST_STATE_ROOT',
      );
      expect(fs.readFileSync(marker, 'utf8')).toBe('keep');
    } finally {
      if (previousRoot === undefined) delete process.env.CAMOFOX_TEST_STATE_ROOT;
      else process.env.CAMOFOX_TEST_STATE_ROOT = previousRoot;
      if (previousProfiles === undefined) delete process.env.CAMOFOX_PROFILES_DIR;
      else process.env.CAMOFOX_PROFILES_DIR = previousProfiles;
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('refuses a deletion root that is not a direct camofox Jest temp directory', () => {
    const { resetTestStateDirectories } = require('../helpers/test-state-reset');
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'camofox-safety-parent-'));
    const root = path.join(parent, '.camofox');
    const profiles = path.join(root, 'profiles');
    const marker = path.join(profiles, 'keep.txt');
    fs.mkdirSync(profiles, { recursive: true });
    fs.writeFileSync(marker, 'keep');

    const previousRoot = process.env.CAMOFOX_TEST_STATE_ROOT;
    const previousProfiles = process.env.CAMOFOX_PROFILES_DIR;
    try {
      process.env.CAMOFOX_TEST_STATE_ROOT = root;
      process.env.CAMOFOX_PROFILES_DIR = profiles;

      expect(() => resetTestStateDirectories(['CAMOFOX_PROFILES_DIR'])).toThrow(
        'CAMOFOX_TEST_STATE_ROOT is not a disposable Jest temp directory',
      );
      expect(fs.readFileSync(marker, 'utf8')).toBe('keep');
    } finally {
      if (previousRoot === undefined) delete process.env.CAMOFOX_TEST_STATE_ROOT;
      else process.env.CAMOFOX_TEST_STATE_ROOT = previousRoot;
      if (previousProfiles === undefined) delete process.env.CAMOFOX_PROFILES_DIR;
      else process.env.CAMOFOX_PROFILES_DIR = previousProfiles;
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
