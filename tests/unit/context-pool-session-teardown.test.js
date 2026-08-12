jest.mock('../../dist/src/utils/config', () => ({
  loadConfig: jest.fn(() => ({
    maxSessions: 10,
    userDataDir: '/tmp/camofox-test',
    profilesDir: '/tmp/camofox-test/profiles',
    downloadsDir: '/tmp/camofox-test/downloads',
    port: 3000,
    headless: true,
    vncResolution: '1280x720x24',
    proxy: { host: '', port: '', username: '', password: '' },
    fingerprintDefaults: {},
    sessionTimeoutMs: 600000,
    maxTabsPerSession: 50,
  })),
}));

jest.mock('camoufox-js', () => ({
  launchOptions: jest.fn(() => Promise.resolve({})),
}));
jest.mock('camoufox-js/dist/fingerprints.js', () => ({
  generateFingerprint: jest.fn(() => ({})),
}));
jest.mock('camoufox-js/dist/pkgman.js', () => ({
  installedVerStr: jest.fn(() => '1.0.0'),
}));
jest.mock('playwright-core', () => ({
  firefox: { launchPersistentContext: jest.fn() },
}));

jest.mock('../../dist/src/utils/sidecar-version', () => ({
  readVersionedSidecar: jest.fn(() => null),
  writeVersionedSidecar: jest.fn(),
}));
jest.mock('../../dist/src/middleware/logging', () => ({ log: jest.fn() }));
jest.mock('../../dist/src/services/tab', () => ({
  clearTabLock: jest.fn(),
  clearAllTabLocks: jest.fn(),
}));
jest.mock('../../dist/src/services/download', () => ({ cleanupUserDownloads: jest.fn() }));
jest.mock('../../dist/src/services/health', () => ({
  decrementActiveOps: jest.fn(),
  incrementActiveOps: jest.fn(),
  deleteUserHealth: jest.fn(),
}));
jest.mock('../../dist/src/services/vnc', () => ({ stopVnc: jest.fn() }));
jest.mock('../../dist/src/services/tracing', () => ({ cleanupTracing: jest.fn() }));

const sessionModule = require('../../dist/src/services/session');
const { contextPool } = require('../../dist/src/services/context-pool');

function makeContext() {
  return {
    pages: jest.fn(() => []),
    close: jest.fn(async () => {}),
  };
}

function makeSession(context, createdAt, tabId) {
  return {
    context,
    tabGroups: new Map([[
      'default',
      new Map([[
        tabId,
        {
          page: { url: () => 'about:blank', close: jest.fn(async () => {}) },
          visitedUrls: new Set(),
          refs: new Map(),
          toolCalls: 0,
          downloads: [],
        },
      ]]),
    ]]),
    lastAccess: createdAt,
    createdAt,
  };
}

function makePoolEntry(userId, profileKey, context, createdAt) {
  return {
    context,
    userId,
    profileKey,
    profileDir: `/tmp/camofox-test/profiles/${profileKey}`,
    lastAccess: createdAt,
    createdAt,
    staged: false,
  };
}

describe('ContextPool.closeContextBySession production boundary', () => {
  beforeEach(() => {
    sessionModule.clearAllState();
    contextPool.pool.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    sessionModule.clearAllState();
    contextPool.pool.clear();
  });

  test('preserves a same-key replacement created after close starts', async () => {
    const userId = 'replacement-owner';
    const sessionKey = 'replacement-session-key';
    const originalCreatedAt = 1000;
    const replacementCreatedAt = 2000;
    const originalTabId = 'original-tab';
    const replacementTabId = 'replacement-tab';
    const sessions = sessionModule.__getSessionsMapForTests();
    const sessionOwners = sessionModule.__getSessionOwnersForTests();

    const originalContext = makeContext();
    const originalSession = makeSession(originalContext, originalCreatedAt, originalTabId);
    const originalPoolEntry = makePoolEntry(userId, sessionKey, originalContext, originalCreatedAt);
    sessions.set(sessionKey, originalSession);
    sessionOwners.set(sessionKey, userId);
    sessionModule.indexTab(originalTabId, sessionKey);
    contextPool.pool.set(sessionKey, originalPoolEntry);

    const closePromise = contextPool.closeContextBySession(userId, sessionKey);

    const replacementContext = makeContext();
    const replacementSession = makeSession(replacementContext, replacementCreatedAt, replacementTabId);
    const replacementPoolEntry = makePoolEntry(userId, sessionKey, replacementContext, replacementCreatedAt);
    sessions.set(sessionKey, replacementSession);
    sessionOwners.set(sessionKey, userId);
    sessionModule.indexTab(replacementTabId, sessionKey);
    contextPool.pool.set(sessionKey, replacementPoolEntry);

    await closePromise;

    expect(sessions.get(sessionKey)).toBe(replacementSession);
    expect(sessionOwners.get(sessionKey)).toBe(userId);
    expect(contextPool.getEntry(sessionKey)).toBe(replacementPoolEntry);
    expect(sessionModule.findTabById(replacementTabId, userId)).not.toBeNull();
    expect(originalContext.close).toHaveBeenCalledTimes(1);
    expect(replacementContext.close).not.toHaveBeenCalled();
  });

  test('fails closed for a foreign owner when the pool entry is missing', async () => {
    const victimUser = 'victim-owner';
    const foreignUser = 'foreign-owner';
    const sessionKey = 'missing-pool-foreign-key';
    const tabId = 'victim-tab';
    const sessions = sessionModule.__getSessionsMapForTests();
    const sessionOwners = sessionModule.__getSessionOwnersForTests();
    const context = makeContext();
    const session = makeSession(context, 1000, tabId);

    sessions.set(sessionKey, session);
    sessionOwners.set(sessionKey, victimUser);
    sessionModule.indexTab(tabId, sessionKey);

    await contextPool.closeContextBySession(foreignUser, sessionKey);

    expect(sessions.get(sessionKey)).toBe(session);
    expect(sessionOwners.get(sessionKey)).toBe(victimUser);
    expect(sessionModule.findTabById(tabId, victimUser)).not.toBeNull();
    expect(context.close).not.toHaveBeenCalled();
  });

  test('cleans the owner session indexes when the pool entry is missing', async () => {
    const userId = 'stale-owner';
    const sessionKey = 'missing-pool-owner-key';
    const tabId = 'stale-tab';
    const sessions = sessionModule.__getSessionsMapForTests();
    const sessionOwners = sessionModule.__getSessionOwnersForTests();
    const context = makeContext();

    sessions.set(sessionKey, makeSession(context, 1000, tabId));
    sessionOwners.set(sessionKey, userId);
    sessionModule.indexTab(tabId, sessionKey);

    await contextPool.closeContextBySession(userId, sessionKey);

    expect(sessions.has(sessionKey)).toBe(false);
    expect(sessionOwners.has(sessionKey)).toBe(false);
    expect(sessionModule.findTabById(tabId, userId)).toBeNull();
    expect(context.close).not.toHaveBeenCalled();
  });
});
