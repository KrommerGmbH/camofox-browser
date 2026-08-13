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
    on: jest.fn(),
  };
}

function makeSession(context, createdAt, tabId, generation = `generation:${createdAt}`) {
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
    generation,
  };
}

function makePoolEntry(userId, profileKey, context, createdAt, generation = `generation:${createdAt}`) {
  return {
    context,
    userId,
    profileKey,
    profileDir: `/tmp/camofox-test/profiles/${profileKey}`,
    lastAccess: createdAt,
    createdAt,
    generation,
    staged: false,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition not reached');
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

  test('preserves the real session when getSession rebinds it during close teardown', async () => {
    const userId = 'rebind-owner';
    const sessionKey = sessionModule.getSessionMapKey(userId, null);
    const originalCreatedAt = 1000;
    const originalTabId = 'rebind-original-tab';
    const sessions = sessionModule.__getSessionsMapForTests();
    const sessionOwners = sessionModule.__getSessionOwnersForTests();
    const { firefox } = require('playwright-core');

    const originalContext = makeContext();
    const originalSession = makeSession(originalContext, originalCreatedAt, originalTabId);
    const originalGeneration = originalSession.generation;
    sessions.set(sessionKey, originalSession);
    sessionOwners.set(sessionKey, userId);
    sessionModule.indexTab(originalTabId, sessionKey);
    contextPool.pool.set(
      sessionKey,
      makePoolEntry(userId, sessionKey, originalContext, originalCreatedAt),
    );

    const replacementContext = makeContext();
    firefox.launchPersistentContext.mockResolvedValueOnce(replacementContext);

    const closePromise = contextPool.closeContextBySession(userId, sessionKey);
    const getPromise = sessionModule.getSession(userId);

    const returnedSession = await getPromise;
    await closePromise;

    expect(returnedSession).toBe(originalSession);
    expect(returnedSession.context).toBe(replacementContext);
    expect(returnedSession.generation).not.toBe(originalGeneration);
    expect(sessions.get(sessionKey)).toBe(originalSession);
    expect(sessionOwners.get(sessionKey)).toBe(userId);
    expect(contextPool.getEntry(sessionKey)?.context).toBe(replacementContext);
  });

  test('preserves a rebound real session when old and replacement timestamps collide', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const userId = 'rebind-equal-time-owner';
      const sessionKey = sessionModule.getSessionMapKey(userId, null);
      const originalTabId = 'rebind-equal-time-tab';
      const sessions = sessionModule.__getSessionsMapForTests();
      const sessionOwners = sessionModule.__getSessionOwnersForTests();
      const { firefox } = require('playwright-core');

      const originalContext = makeContext();
      const originalSession = makeSession(originalContext, 1000, originalTabId);
      const originalGeneration = originalSession.generation;
      sessions.set(sessionKey, originalSession);
      sessionOwners.set(sessionKey, userId);
      sessionModule.indexTab(originalTabId, sessionKey);
      contextPool.pool.set(
        sessionKey,
        makePoolEntry(userId, sessionKey, originalContext, 1000),
      );

      const replacementContext = makeContext();
      firefox.launchPersistentContext.mockResolvedValueOnce(replacementContext);

      const closePromise = contextPool.closeContextBySession(userId, sessionKey);
      const getPromise = sessionModule.getSession(userId);

      const returnedSession = await getPromise;
      await closePromise;

      expect(returnedSession).toBe(originalSession);
      expect(returnedSession.createdAt).toBe(1000);
      expect(returnedSession.context).toBe(replacementContext);
      expect(returnedSession.generation).not.toBe(originalGeneration);
      expect(sessions.get(sessionKey)).toBe(originalSession);
      expect(sessionOwners.get(sessionKey)).toBe(userId);
      expect(contextPool.getEntry(sessionKey)?.createdAt).toBe(1000);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('preserves replacement when getSession installs it before recovery snapshots equal timestamps', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const userId = 'reverse-order-owner';
      const sessionKey = sessionModule.getSessionMapKey(userId, null);
      const tabId = 'reverse-order-tab';
      const sessions = sessionModule.__getSessionsMapForTests();
      const sessionOwners = sessionModule.__getSessionOwnersForTests();
      const { firefox } = require('playwright-core');
      const launchGate = deferred();

      const originalGeneration = 'context-generation-a';
      const originalContext = makeContext();
      originalContext.pages.mockImplementation(() => {
        throw new Error('old context is closed');
      });
      const originalSession = makeSession(originalContext, 1000, tabId, originalGeneration);
      sessions.set(sessionKey, originalSession);
      sessionOwners.set(sessionKey, userId);
      sessionModule.indexTab(tabId, sessionKey);
      contextPool.pool.set(
        sessionKey,
        makePoolEntry(userId, sessionKey, originalContext, 1000, originalGeneration),
      );

      const replacementContext = makeContext();
      firefox.launchPersistentContext.mockReturnValueOnce(launchGate.promise);

      const getPromise = sessionModule.getSession(userId);
      await waitFor(() => contextPool.getEntry(sessionKey)?.launching !== undefined);

      const pendingEntry = contextPool.getEntry(sessionKey);
      expect(pendingEntry).toBeDefined();
      expect(pendingEntry.createdAt).toBe(1000);

      const closePromise = contextPool.closeContextBySession(userId, sessionKey);
      launchGate.resolve(replacementContext);

      const returnedSession = await getPromise;
      await closePromise;

      expect(returnedSession).toBe(originalSession);
      expect(returnedSession.context).toBe(replacementContext);
      expect(replacementContext.close).not.toHaveBeenCalled();
      expect(sessions.get(sessionKey)).toBe(originalSession);
      expect(sessionOwners.get(sessionKey)).toBe(userId);
      expect(sessionModule.findTabById(tabId, userId)).not.toBeNull();
      expect(contextPool.getEntry(sessionKey)?.context).toBe(replacementContext);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('removes stale session when replacement launch fails during overlapping teardown', async () => {
    const userId = 'failed-rebind-owner';
    const sessionKey = sessionModule.getSessionMapKey(userId, null);
    const tabId = 'failed-rebind-tab';
    const sessions = sessionModule.__getSessionsMapForTests();
    const sessionOwners = sessionModule.__getSessionOwnersForTests();
    const { firefox } = require('playwright-core');
    const closeGate = deferred();
    const launchGate = deferred();

    const originalGeneration = 'failed-context-generation-a';
    const originalContext = makeContext();
    originalContext.close.mockReturnValueOnce(closeGate.promise);
    const originalSession = makeSession(originalContext, 1000, tabId, originalGeneration);
    sessions.set(sessionKey, originalSession);
    sessionOwners.set(sessionKey, userId);
    sessionModule.indexTab(tabId, sessionKey);
    contextPool.pool.set(
      sessionKey,
      makePoolEntry(userId, sessionKey, originalContext, 1000, originalGeneration),
    );
    firefox.launchPersistentContext.mockReturnValueOnce(launchGate.promise);

    const closePromise = contextPool.closeContextBySession(userId, sessionKey);
    const getPromise = sessionModule.getSession(userId);
    expect(originalSession.generation).toBe(originalGeneration);
    closeGate.resolve();
    await waitFor(() => contextPool.getEntry(sessionKey)?.launching !== undefined);
    expect(originalSession.generation).toBe(originalGeneration);
    launchGate.reject(new Error('replacement launch failed'));

    await expect(getPromise).rejects.toThrow('replacement launch failed');
    await closePromise;

    expect(sessions.has(sessionKey)).toBe(false);
    expect(sessionOwners.has(sessionKey)).toBe(false);
    expect(sessionModule.findTabById(tabId, userId)).toBeNull();
    expect(contextPool.getEntry(sessionKey)).toBeUndefined();
  });

  test('concurrent getSession callers commit one replacement context identity', async () => {
    const userId = 'concurrent-rebind-owner';
    const sessionKey = sessionModule.getSessionMapKey(userId, null);
    const tabId = 'concurrent-rebind-tab';
    const sessions = sessionModule.__getSessionsMapForTests();
    const sessionOwners = sessionModule.__getSessionOwnersForTests();
    const { firefox } = require('playwright-core');
    const launchGate = deferred();

    const originalGeneration = 'concurrent-context-generation-a';
    const originalContext = makeContext();
    originalContext.pages.mockImplementation(() => {
      throw new Error('old context is closed');
    });
    const originalSession = makeSession(originalContext, 1000, tabId, originalGeneration);
    sessions.set(sessionKey, originalSession);
    sessionOwners.set(sessionKey, userId);
    sessionModule.indexTab(tabId, sessionKey);
    contextPool.pool.set(
      sessionKey,
      makePoolEntry(userId, sessionKey, originalContext, 1000, originalGeneration),
    );

    const replacementContext = makeContext();
    firefox.launchPersistentContext.mockReturnValueOnce(launchGate.promise);
    const first = sessionModule.getSession(userId);
    const second = sessionModule.getSession(userId);
    await waitFor(() => contextPool.getEntry(sessionKey)?.launching !== undefined);
    launchGate.resolve(replacementContext);

    const [firstSession, secondSession] = await Promise.all([first, second]);
    const entry = contextPool.getEntry(sessionKey);

    expect(firstSession).toBe(originalSession);
    expect(secondSession).toBe(originalSession);
    expect(firstSession.context).toBe(replacementContext);
    expect(firstSession.generation).toBe(entry.generation);
    expect(firefox.launchPersistentContext).toHaveBeenCalledTimes(1);
    expect(sessionModule.findTabById(tabId, userId)).not.toBeNull();
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
