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
jest.mock('../../dist/src/services/vnc', () => ({ stopVnc: jest.fn(async () => {}) }));
jest.mock('../../dist/src/services/tracing', () => ({ cleanupTracing: jest.fn() }));

const sessionModule = require('../../dist/src/services/session');
const { contextPool } = require('../../dist/src/services/context-pool');
const { firefox } = require('playwright-core');

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
    sessionModule.stopCleanupInterval();
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

  test.each([
    ['explicit close', (userId) => sessionModule.closeSessionsForUser(userId)],
    ['bulk close', () => sessionModule.closeAllSessions()],
  ])('%s tombstones a pending rebind before closing its replacement', async (_label, closeSessions) => {
    const userId = `pending-close-${_label.replace(/\s/g, '-')}`;
    const sessionKey = sessionModule.getSessionMapKey(userId, null);
    const tabId = `${userId}-tab`;
    const sessions = sessionModule.__getSessionsMapForTests();
    const sessionOwners = sessionModule.__getSessionOwnersForTests();
    const launchGate = deferred();
    const originalContext = makeContext();
    originalContext.pages.mockImplementation(() => {
      throw new Error('old context is closed');
    });
    const originalSession = makeSession(originalContext, 1000, tabId, 'pending-close-old');
    sessions.set(sessionKey, originalSession);
    sessionOwners.set(sessionKey, userId);
    sessionModule.indexTab(tabId, sessionKey);
    contextPool.pool.set(sessionKey, makePoolEntry(userId, sessionKey, originalContext, 1000, 'pending-close-old'));

    const replacementContext = makeContext();
    firefox.launchPersistentContext.mockReturnValueOnce(launchGate.promise);
    const getPromise = sessionModule.getSession(userId);
    await waitFor(() => contextPool.getEntry(sessionKey)?.launching !== undefined);

    const closePromise = closeSessions(userId);
    launchGate.resolve(replacementContext);

    await expect(getPromise).rejects.toThrow(/closed|superseded/i);
    await closePromise;
    expect(replacementContext.close).toHaveBeenCalledTimes(1);
    expect(sessions.has(sessionKey)).toBe(false);
    expect(sessionOwners.has(sessionKey)).toBe(false);
    expect(sessionModule.findTabById(tabId, userId)).toBeNull();
    expect(contextPool.getEntry(sessionKey)).toBeUndefined();
  });

  test.each([
    ['explicit close', (userId) => sessionModule.closeSessionsForUser(userId)],
    ['bulk close', () => sessionModule.closeAllSessions()],
  ])('%s fences a rebind that starts after teardown begins', async (_label, closeSessions) => {
    const userId = `late-rebind-${_label.replace(/\s/g, '-')}`;
    const sessionKey = sessionModule.getSessionMapKey(userId, null);
    const sessions = sessionModule.__getSessionsMapForTests();
    const sessionOwners = sessionModule.__getSessionOwnersForTests();
    const closeGate = deferred();
    const oldContext = makeContext();
    oldContext.close.mockReturnValueOnce(closeGate.promise);
    const oldSession = makeSession(oldContext, 1000, `${userId}-old-tab`, 'late-rebind-old');
    sessions.set(sessionKey, oldSession);
    sessionOwners.set(sessionKey, userId);
    contextPool.pool.set(sessionKey, makePoolEntry(userId, sessionKey, oldContext, 1000, 'late-rebind-old'));

    const closePromise = closeSessions(userId);
    await waitFor(() => contextPool.getEntry(sessionKey)?.closing !== undefined);

    const replacementContext = makeContext();
    firefox.launchPersistentContext.mockResolvedValueOnce(replacementContext);
    const getPromise = sessionModule.getSession(userId);
    expect(firefox.launchPersistentContext).not.toHaveBeenCalled();

    closeGate.resolve();
    await closePromise;
    await expect(getPromise).rejects.toThrow(/superseded|closure/i);

    expect(replacementContext.close).toHaveBeenCalledTimes(1);
    expect(sessions.has(sessionKey)).toBe(false);
    expect(sessionOwners.has(sessionKey)).toBe(false);
    expect(contextPool.getEntry(sessionKey)).toBeUndefined();
  });

  test('concurrent bulk closes share the global fence until both complete', async () => {
    const userId = 'concurrent-global-close-owner';
    const sessionKey = sessionModule.getSessionMapKey(userId, null);
    const closeGate = deferred();
    const oldContext = makeContext();
    oldContext.close.mockReturnValueOnce(closeGate.promise);
    const oldSession = makeSession(oldContext, 1000, 'concurrent-global-close-tab', 'concurrent-global-close-old');
    sessionModule.__getSessionsMapForTests().set(sessionKey, oldSession);
    sessionModule.__getSessionOwnersForTests().set(sessionKey, userId);
    contextPool.pool.set(sessionKey, makePoolEntry(userId, sessionKey, oldContext, 1000, 'concurrent-global-close-old'));

    const firstClose = sessionModule.closeAllSessions();
    const secondClose = sessionModule.closeAllSessions();
    await waitFor(() => contextPool.getEntry(sessionKey)?.closing !== undefined);

    const replacementContext = makeContext();
    firefox.launchPersistentContext.mockResolvedValueOnce(replacementContext);
    const getPromise = sessionModule.getSession(userId);
    expect(firefox.launchPersistentContext).not.toHaveBeenCalled();

    closeGate.resolve();
    await Promise.all([firstClose, secondClose]);
    await expect(getPromise).rejects.toThrow(/superseded|closure/i);
    expect(replacementContext.close).toHaveBeenCalledTimes(1);
    expect(contextPool.getEntry(sessionKey)).toBeUndefined();
  });

  test.each([
    ['staged first-use', true],
    ['internal context', false],
  ])('global closure gates %s launches at ContextPool admission', async (_label, staged) => {
    const blockerUser = `global-gate-blocker-${_label}`;
    const blockerKey = `global-gate-blocker-key-${_label}`;
    const closeGate = deferred();
    const blockerContext = makeContext();
    blockerContext.close.mockReturnValueOnce(closeGate.promise);
    contextPool.pool.set(blockerKey, makePoolEntry(blockerUser, blockerKey, blockerContext, 1000, `blocker:${_label}`));

    const closePromise = sessionModule.closeAllSessions();
    await waitFor(() => contextPool.getEntry(blockerKey)?.closing !== undefined);

    const launchUser = `global-gate-launch-${_label}`;
    const launchKey = `global-gate-launch-key-${_label}`;
    const launchedContext = makeContext();
    firefox.launchPersistentContext.mockResolvedValueOnce(launchedContext);
    const launchPromise = contextPool.ensureContext(
      launchKey,
      launchUser,
      undefined,
      undefined,
      staged,
      staged ? `staged:${_label}` : undefined,
    );
    expect(firefox.launchPersistentContext).not.toHaveBeenCalled();

    closeGate.resolve();
    await closePromise;
    const entry = await launchPromise;

    expect(entry.context).toBe(launchedContext);
    expect(contextPool.getEntry(launchKey)).toBe(entry);
  });

  test('timeout cleanup skips a session while its replacement rebind is pending', async () => {
    jest.useFakeTimers();
    try {
      const userId = 'pending-timeout-owner';
      const sessionKey = sessionModule.getSessionMapKey(userId, null);
      const tabId = 'pending-timeout-tab';
      const sessions = sessionModule.__getSessionsMapForTests();
      const sessionOwners = sessionModule.__getSessionOwnersForTests();
      const launchGate = deferred();
      const originalContext = makeContext();
      originalContext.pages.mockImplementation(() => {
        throw new Error('old context is closed');
      });
      const originalSession = makeSession(originalContext, 0, tabId, 'pending-timeout-old');
      sessions.set(sessionKey, originalSession);
      sessionOwners.set(sessionKey, userId);
      sessionModule.indexTab(tabId, sessionKey);
      contextPool.pool.set(sessionKey, makePoolEntry(userId, sessionKey, originalContext, 0, 'pending-timeout-old'));

      const replacementContext = makeContext();
      firefox.launchPersistentContext.mockReturnValueOnce(launchGate.promise);
      const getPromise = sessionModule.getSession(userId);
      await waitFor(() => contextPool.getEntry(sessionKey)?.launching !== undefined);

      sessionModule.startCleanupInterval();
      jest.advanceTimersByTime(60_000);
      expect(sessions.get(sessionKey)).toBe(originalSession);

      launchGate.resolve(replacementContext);
      const rebound = await getPromise;
      expect(rebound).toBe(originalSession);
      expect(rebound.context).toBe(replacementContext);
      expect(sessions.get(sessionKey)).toBe(originalSession);
      expect(sessionModule.findTabById(tabId, userId)).not.toBeNull();

      rebound.lastAccess = Date.now() - 600_001;
      jest.advanceTimersByTime(60_000);
      expect(sessions.has(sessionKey)).toBe(false);
      expect(sessionOwners.has(sessionKey)).toBe(false);
      expect(sessionModule.findTabById(tabId, userId)).toBeNull();
    } finally {
      sessionModule.stopCleanupInterval();
      jest.useRealTimers();
    }
  });

  test('stale context close callback cannot remove a newer same-key pool entry', async () => {
    const userId = 'stale-listener-owner';
    const sessionKey = 'stale-listener-session';
    let oldCloseListener;
    let oldIsDead = false;
    const oldContext = makeContext();
    oldContext.pages.mockImplementation(() => {
      if (oldIsDead) throw new Error('old context died');
      return [];
    });
    oldContext.on.mockImplementation((event, listener) => {
      if (event === 'close') oldCloseListener = listener;
    });
    const replacementContext = makeContext();
    firefox.launchPersistentContext
      .mockResolvedValueOnce(oldContext)
      .mockResolvedValueOnce(replacementContext);

    const oldEntry = await contextPool.ensureContext(sessionKey, userId);
    oldIsDead = true;
    const replacementEntry = await contextPool.ensureContext(sessionKey, userId);
    expect(replacementEntry.generation).not.toBe(oldEntry.generation);
    expect(contextPool.getEntry(sessionKey)).toBe(replacementEntry);

    oldCloseListener();
    expect(contextPool.getEntry(sessionKey)).toBe(replacementEntry);
    expect(replacementEntry.context).toBe(replacementContext);
  });

  test('stale context launch failure cannot remove a newer same-key pool entry', async () => {
    const userId = 'stale-launch-owner';
    const sessionKey = 'stale-launch-session';
    const launchGate = deferred();
    firefox.launchPersistentContext.mockReturnValueOnce(launchGate.promise);

    const staleLaunch = contextPool.ensureContext(sessionKey, userId);
    await waitFor(() => contextPool.getEntry(sessionKey)?.launching !== undefined);
    const staleEntry = contextPool.getEntry(sessionKey);
    const replacementContext = makeContext();
    const replacementEntry = makePoolEntry(userId, sessionKey, replacementContext, 2000, 'replacement-generation');
    contextPool.pool.set(sessionKey, replacementEntry);

    launchGate.reject(new Error('stale launch failed'));
    await expect(staleLaunch).rejects.toThrow('stale launch failed');
    expect(contextPool.getEntry(sessionKey)).toBe(replacementEntry);
    expect(contextPool.getEntry(sessionKey)).not.toBe(staleEntry);
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
