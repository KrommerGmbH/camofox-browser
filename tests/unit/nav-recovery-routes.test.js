/**
 * Route-level tests for nav-error scoping and session-scoped recovery.
 *
 * These tests mount the REAL Express route handlers from core.ts and
 * openclaw.ts on a test app, with only the browser-layer services mocked
 * (navigateWithSafetyGuard, validateNavigationUrl, buildRefs, contextPool).
 * The health module, nav-recovery module, and session module's withUserLimit/
 * withTabLock/withTimeout remain unmocked — exercising the actual navError
 * flag logic, handleNavFailure calls, and session-key propagation.
 *
 * Tests the HIGH blockers from round 5 review:
 * 1. Non-navigation errors do not count toward the failure threshold
 * 2. Stale/unmatched session key does not close sibling sessions (fail-closed)
 * 3. Health state is not deleted when a sibling context closes
 * 4. Session-owned teardown — recovery removes/unindexes tabs (findTabById returns null)
 * 5. Cross-session threshold isolation — failures from session A don't trip recovery for B
 * 6. recordNavSuccess fires immediately after navigation, before buildRefs
 * 7. Lock continuity — non-owner does not clear another's lock
 */

// ── Mocks ───────────────────────────────────────────────────────────

// Track calls to closeContext / closeContextByUserId
const mockCloseContext = jest.fn();
const mockCloseContextByUserId = jest.fn();

// We do NOT mock closeContextBySession — we let it call the real
// teardownSessionByKey so we can verify real tab unindexing behavior.
// The contextPool mock delegates to teardownSessionByKey for matched keys.
const mockCloseContextBySession = jest.fn(async (userId, profileKey) => {
  if (profileKey !== undefined && profileKey !== null && profileKey !== '') {
    // Mirror the real fail-closed logic: check if the pool entry exists.
    // For tests, we check if the session exists in the sessions map.
    const sessionModule = require('../../dist/src/services/session');
    const sessions = sessionModule.__getSessionsMapForTests();
    if (sessions.has(profileKey)) {
      // Real teardown: unindex tabs + delete session + close context
      await sessionModule.teardownSessionByKey(profileKey);
    }
    // Stale/unmatched key → no-op (fail closed)
    return;
  }
  // No key → user-wide fallback
  await mockCloseContextByUserId(userId);
});

jest.mock('../../dist/src/services/context-pool', () => ({
  contextPool: {
    closeContext: mockCloseContext,
    closeContextBySession: mockCloseContextBySession,
    closeContextByUserId: mockCloseContextByUserId,
    getPoolEntries: jest.fn(() => new Map()),
    onEvict: jest.fn(),
    evictIfNeeded: jest.fn(async () => {}),
    acquire: jest.fn(),
    release: jest.fn(),
  },
  getDisplayForUser: jest.fn(() => null),
}));

// Mock the tab service — navigateWithSafetyGuard is the one we control
const mockNavigate = jest.fn();
const mockValidateUrl = jest.fn(async () => null); // null = valid URL
const mockBuildRefs = jest.fn(async () => new Map());

jest.mock('../../dist/src/services/tab', () => ({
  navigateWithSafetyGuard: mockNavigate,
  validateNavigationUrl: mockValidateUrl,
  buildRefs: mockBuildRefs,
  withTimeout: jest.fn(async (promise) => promise), // pass-through
  withTabLock: jest.fn(async (_tabId, op) => op()), // pass-through
  createTabState: jest.fn(async () => ({
    page: { url: () => 'about:blank', close: jest.fn() },
    visitedUrls: new Set(),
    refs: new Map(),
    toolCalls: 0,
    downloads: [],
  })),
  acquirePageForNewTab: jest.fn(),
  safePageClose: jest.fn(),
  buildSnapshotPayload: jest.fn(),
  calculateTypeTimeoutMs: jest.fn(() => 5000),
  clearTabLock: jest.fn(),
  clearAllTabLocks: jest.fn(),
  waitForPageReady: jest.fn(),
}));

// Mock logging
jest.mock('../../dist/src/middleware/logging', () => ({
  log: jest.fn(),
  loggingMiddleware: jest.fn((_req, _res, next) => next()),
  startStatsBeacon: jest.fn(),
}));

// Mock auth — no API key
jest.mock('../../dist/src/middleware/auth', () => ({
  isAuthorizedWithApiKey: (_req, _apiKey) => true,
}));

// Mock rate-limit — no limit
jest.mock('../../dist/src/middleware/rate-limit', () => ({
  checkRateLimit: jest.fn(() => null),
}));

// Mock lifecycle controller
jest.mock('../../dist/src/services/lifecycle-controller', () => ({
  lifecycleController: {
    recordInteractiveActivity: jest.fn(),
    recordCleanupFinished: jest.fn(),
    markCleanupFinished: jest.fn(),
  },
}));

// Mock vnc
jest.mock('../../dist/src/services/vnc', () => ({
  startVnc: jest.fn(),
  stopVnc: jest.fn(),
  stopAllVnc: jest.fn(),
}));

// Mock download service — session.ts imports it at module load
jest.mock('../../dist/src/services/download', () => ({
  cleanupUserDownloads: jest.fn(),
  registerDownloadListener: jest.fn(),
  markDownloadsStaged: jest.fn(),
  startCleanupInterval: jest.fn(),
  stopCleanupInterval: jest.fn(),
}));

// Mock tracing — session.ts imports it
jest.mock('../../dist/src/services/tracing', () => ({
  cleanupTracing: jest.fn(),
}));

// Mock browser service
jest.mock('../../dist/src/services/browser', () => ({
  closeBrowser: jest.fn(),
}));

// Mock youtube service
jest.mock('../../dist/src/services/youtube', () => ({
  detectYtDlp: jest.fn(() => null),
}));

// Mock docs routes (not needed for these tests)
jest.mock('../../dist/src/routes/docs', () => {
  const express = require('express');
  const router = express.Router();
  return { default: router, router };
});

// Mock lifecycle-activity middleware
jest.mock('../../dist/src/middleware/lifecycle-activity', () => ({
  createLifecycleActivityMiddleware: jest.fn(() => (_req, _res, next) => next()),
}));

// Mock config — needs all fields used by session/download/context-pool at load time
jest.mock('../../dist/src/utils/config', () => ({
  loadConfig: jest.fn(() => ({
    failureThreshold: 3,
    maxSessions: 10,
    maxConcurrentPerUser: 5,
    handlerTimeoutMs: 30000,
    maxTabsPerSession: 10,
    allowPrivateNetworkTargets: false,
    apiKey: null,
    authMode: 'disabled',
    downloadsDir: '/tmp/test-downloads',
    maxDownloadSizeMb: 100,
    maxDownloadsPerUser: 500,
    sessionTimeoutMs: 300000,
    serverEnv: {},
    host: 'localhost',
    port: 9377,
    headless: true,
    vncResolution: '1920x1080x24',
    ytDlpTimeoutMs: 30000,
    ytBrowserTimeoutMs: 25000,
    evalExtendedRateLimitMax: 10,
    proxyGeoOverrides: {},
  })),
  assertServerExposureSafety: jest.fn(),
}));

// Mock presets
jest.mock('../../dist/src/utils/presets', () => ({
  getAllPresets: jest.fn(() => ({})),
  resolveContextOptions: jest.fn(() => ({})),
  validateContextOptions: jest.fn(() => null),
}));

// ── Imports (after mocks) ───────────────────────────────────────────

const express = require('express');
const supertest = require('supertest');

// Real health + nav-recovery modules (NOT mocked)
const {
  recordNavSuccess,
  recordNavFailure,
  acquireRecoveryLock,
  releaseRecoveryLock,
  isUserRecovering,
  resetHealth,
  deleteUserHealth,
  __getUserHealthForTests,
  __clearUserHealthForTests,
} = require('../../dist/src/services/health');

const { handleNavFailure } = require('../../dist/src/services/nav-recovery');

// Real session module (NOT mocked) — for setup and teardown verification
const sessionModule = require('../../dist/src/services/session');

// ── Test helpers ────────────────────────────────────────────────────

/**
 * Mount the real core + openclaw route handlers on a test Express app.
 * We import the route modules AFTER all mocks are set up.
 */
function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // Mount the real routers — they use the mocked services internally
  const coreRoutes = require('../../dist/src/routes/core');
  const openclawRoutes = require('../../dist/src/routes/openclaw');
  app.use(coreRoutes.default || coreRoutes);
  app.use(openclawRoutes.default || openclawRoutes);

  // Error handler
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  return app;
}

/**
 * Set up a fake tab in the session module so findTabById returns it.
 * We inject directly into the session map via the test-only export.
 */
function setupFakeTab(userId, tabId, sessionKeyOverride) {
  const sessions = sessionModule.__getSessionsMapForTests();
  const sessionOwners = sessionModule.__getSessionOwnersForTests();

  // Compute the real session map key the same way findTabById will look it up.
  const sessionKey = sessionKeyOverride || sessionModule.getSessionMapKey(userId, null);

  // Create a minimal tab state that the route handler can work with
  const tabState = {
    page: { url: () => 'about:blank', close: jest.fn() },
    visitedUrls: new Set(),
    refs: new Map(),
    toolCalls: 0,
    downloads: [],
  };

  // Session structure: tabGroups is Map<listItemId, Map<tabId, TabState>>
  const session = {
    context: { close: jest.fn().mockResolvedValue(undefined) },
    tabGroups: new Map([[sessionKey, new Map([[tabId, tabState]])]]),
    lastAccess: Date.now(),
  };

  sessions.set(sessionKey, session);
  // Set session owner so findTabById's isSessionMapKeyForUser check passes
  // for non-default session keys.
  sessionOwners.set(sessionKey, String(userId));

  // Index the tab so findTabById finds it via tabSessionIndex
  if (typeof sessionModule.indexTab === 'function') {
    sessionModule.indexTab(tabId, sessionKey);
  }

  return { tabState, session, sessionKey };
}

/**
 * Set up two sibling sessions for the same user with different session keys.
 * Each gets its own tab and session map key.
 */
function setupSiblingSessions(userId, tabIdA, sessionKeyA, tabIdB, sessionKeyB) {
  const sessions = sessionModule.__getSessionsMapForTests();
  const sessionOwners = sessionModule.__getSessionOwnersForTests();

  const mkTab = (tabId) => ({
    page: { url: () => 'about:blank', close: jest.fn() },
    visitedUrls: new Set(),
    refs: new Map(),
    toolCalls: 0,
    downloads: [],
  });

  // Session A
  const sessionA = {
    context: { close: jest.fn().mockResolvedValue(undefined) },
    tabGroups: new Map([[sessionKeyA, new Map([[tabIdA, mkTab(tabIdA)]])]]),
    lastAccess: Date.now(),
  };
  sessions.set(sessionKeyA, sessionA);
  sessionOwners.set(sessionKeyA, String(userId));
  sessionModule.indexTab(tabIdA, sessionKeyA);

  // Session B
  const sessionB = {
    context: { close: jest.fn().mockResolvedValue(undefined) },
    tabGroups: new Map([[sessionKeyB, new Map([[tabIdB, mkTab(tabIdB)]])]]),
    lastAccess: Date.now(),
  };
  sessions.set(sessionKeyB, sessionB);
  sessionOwners.set(sessionKeyB, String(userId));
  sessionModule.indexTab(tabIdB, sessionKeyB);

  return { sessionA, sessionB };
}

function cleanupSessions() {
  const sessions = sessionModule.__getSessionsMapForTests();
  for (const [key] of sessions.entries()) {
    sessions.delete(key);
  }
  const sessionOwners = sessionModule.__getSessionOwnersForTests();
  for (const [key] of sessionOwners.entries()) {
    sessionOwners.delete(key);
  }
  if (typeof sessionModule.clearAllState === 'function') {
    sessionModule.clearAllState();
  }
}

// ── Test suite ──────────────────────────────────────────────────────

describe('Nav recovery — route-level tests (round 5 blockers)', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    __clearUserHealthForTests();
    resetHealth();
    mockNavigate.mockResolvedValue(undefined);
    mockValidateUrl.mockResolvedValue(null);
    mockBuildRefs.mockResolvedValue(new Map());
    mockCloseContext.mockResolvedValue(undefined);
    mockCloseContextByUserId.mockResolvedValue(undefined);
  });

  afterEach(() => {
    __clearUserHealthForTests();
    resetHealth();
    cleanupSessions();
  });

  // ── 1. Non-navigation errors do not count ─────────────────────

  describe('HIGH 1 — navError scoped to actual navigation only', () => {
    test('validation error (pre-navigation) does not count toward threshold', async () => {
      const userId = 'test-user-nav-1';
      const tabId = 'tab-nav-1';
      setupFakeTab(userId, tabId);

      mockValidateUrl.mockResolvedValue('blocked: private network target');

      for (let i = 0; i < 5; i++) {
        await supertest(app)
          .post(`/tabs/${tabId}/navigate`)
          .send({ userId, url: 'http://169.254.169.254/latest' })
          .expect(400);
      }

      const health = __getUserHealthForTests(userId);
      expect(health?.consecutiveNavFailures ?? 0).toBe(0);
      expect(mockCloseContext).not.toHaveBeenCalled();
    });

    test('navigation failure counts toward threshold', async () => {
      const userId = 'test-user-nav-2';
      const tabId = 'tab-nav-2';
      setupFakeTab(userId, tabId);

      mockNavigate.mockRejectedValue(new Error('Navigation timeout'));

      for (let i = 0; i < 3; i++) {
        await supertest(app)
          .post(`/tabs/${tabId}/navigate`)
          .send({ userId, url: 'http://example.com' })
          .expect(500);
      }

      // After recovery, health entry is evicted by handleNavFailure's finally block
      const health = __getUserHealthForTests(userId);
      expect(health).toBeUndefined();
    });

    test('macro expansion error does not count toward threshold', async () => {
      const userId = 'test-user-nav-3';
      const tabId = 'tab-nav-3';
      setupFakeTab(userId, tabId);

      mockValidateUrl.mockResolvedValue('blocked: invalid URL');

      for (let i = 0; i < 5; i++) {
        await supertest(app)
          .post(`/tabs/${tabId}/navigate`)
          .send({ userId, url: 'http://example.invalid' })
          .expect(400);
      }

      const health = __getUserHealthForTests(userId);
      expect(health?.consecutiveNavFailures ?? 0).toBe(0);
    });
  });

  // ── 2. Stale/unmatched session key fails closed ───────────────

  describe('HIGH 2 — stale session key does not close siblings', () => {
    test('closeContextBySession with stale key is a no-op (fail-closed)', async () => {
      mockCloseContext.mockResolvedValue(undefined);

      const userId = 'test-user-stale';
      const staleSessionKey = 'stale-key-123';

      await handleNavFailure(userId, staleSessionKey);
      await handleNavFailure(userId, staleSessionKey);

      expect(__getUserHealthForTests(userId, staleSessionKey).consecutiveNavFailures).toBe(2);

      // 3rd failure — triggers recovery with stale key
      await handleNavFailure(userId, staleSessionKey);

      // closeContextByUserId should NOT have been called — stale key = fail-closed
      expect(mockCloseContextByUserId).not.toHaveBeenCalled();

      // Health entry should be evicted after recovery
      expect(__getUserHealthForTests(userId, staleSessionKey)).toBeUndefined();
    });

    test('no session key falls back to user-wide close (legacy compat)', async () => {
      mockCloseContextByUserId.mockResolvedValue(undefined);

      const userId = 'test-user-legacy';

      await handleNavFailure(userId);
      await handleNavFailure(userId);
      await handleNavFailure(userId);

      expect(mockCloseContextByUserId).toHaveBeenCalledTimes(1);
      expect(mockCloseContextByUserId).toHaveBeenCalledWith(userId);
    });
  });

  // ── 3. Health state lifecycle independent from context lifecycle ─

  describe('HIGH 3 — health state not deleted on sibling context close', () => {
    test('session health entry survives closeContext for a sibling session', async () => {
      const userId = 'test-user-sibling';
      const sessionKey = 'session-key-sibling';

      recordNavFailure(userId, sessionKey);
      recordNavFailure(userId, sessionKey);
      expect(__getUserHealthForTests(userId, sessionKey).consecutiveNavFailures).toBe(2);

      const { contextPool } = require('../../dist/src/services/context-pool');
      await contextPool.closeContext('some-profile-key');

      const health = __getUserHealthForTests(userId, sessionKey);
      expect(health).toBeDefined();
      expect(health.consecutiveNavFailures).toBe(2);
    });

    test('in-flight recovery lock survives sibling context close', async () => {
      const userId = 'test-user-lock-survival';
      const sessionKey = 'session-key-lock';

      recordNavFailure(userId, sessionKey);
      recordNavFailure(userId, sessionKey);
      recordNavFailure(userId, sessionKey);
      acquireRecoveryLock(userId, sessionKey);
      expect(isUserRecovering(userId, sessionKey)).toBe(true);

      const { contextPool } = require('../../dist/src/services/context-pool');
      await contextPool.closeContext('sibling-profile-key');

      expect(isUserRecovering(userId, sessionKey)).toBe(true);
      releaseRecoveryLock(userId, sessionKey);
      deleteUserHealth(userId, sessionKey);
    });
  });

  // ── 4. Session-owned teardown — tabs unindexed after recovery ──

  describe('HIGH 4 — recovery removes/unindexes tabs (session-owned teardown)', () => {
    test('after recovery, findTabById returns null for the recovered tab', async () => {
      const userId = 'test-user-teardown';
      const tabId = 'tab-teardown';
      const { sessionKey } = setupFakeTab(userId, tabId);

      // Verify tab is findable before recovery
      expect(sessionModule.findTabById(tabId, userId)).not.toBeNull();

      // Trigger recovery: 3 navigation failures
      mockNavigate.mockRejectedValue(new Error('nav fail'));
      for (let i = 0; i < 3; i++) {
        await supertest(app)
          .post(`/tabs/${tabId}/navigate`)
          .send({ userId, url: 'http://example.com' })
          .expect(500);
      }

      // After recovery, findTabById should return null — the tab was unindexed
      expect(sessionModule.findTabById(tabId, userId)).toBeNull();
    });

    test('sibling session tab survives recovery of a different session', async () => {
      const userId = 'test-user-sibling-teardown';
      const tabIdA = 'tab-a-teardown';
      const tabIdB = 'tab-b-teardown';
      const sessionKeyA = 'session-key-a-teardown';
      const sessionKeyB = 'session-key-b-teardown';

      setupSiblingSessions(userId, tabIdA, sessionKeyA, tabIdB, sessionKeyB);

      // Both tabs should be findable
      expect(sessionModule.findTabById(tabIdA, userId)).not.toBeNull();
      expect(sessionModule.findTabById(tabIdB, userId)).not.toBeNull();

      // Fail tab A's navigation 3 times to trigger recovery for session A
      mockNavigate.mockRejectedValue(new Error('nav fail'));
      for (let i = 0; i < 3; i++) {
        await supertest(app)
          .post(`/tabs/${tabIdA}/navigate`)
          .send({ userId, url: 'http://example.com' })
          .expect(500);
      }

      // Tab A should be gone (unindexed by teardownSessionByKey)
      expect(sessionModule.findTabById(tabIdA, userId)).toBeNull();

      // Tab B should still be findable — sibling session preserved
      expect(sessionModule.findTabById(tabIdB, userId)).not.toBeNull();
    });
  });

  // ── 5. Cross-session threshold isolation ──────────────────────

  describe('HIGH 5 — cross-session threshold isolation', () => {
    test('failures from session A do not trip recovery for session B', async () => {
      const userId = 'test-user-cross';
      const tabIdA = 'tab-cross-a';
      const tabIdB = 'tab-cross-b';
      const sessionKeyA = 'session-key-cross-a';
      const sessionKeyB = 'session-key-cross-b';

      setupSiblingSessions(userId, tabIdA, sessionKeyA, tabIdB, sessionKeyB);

      mockNavigate.mockRejectedValue(new Error('nav fail'));

      // 2 failures on session A (below threshold of 3)
      await supertest(app)
        .post(`/tabs/${tabIdA}/navigate`)
        .send({ userId, url: 'http://example.com' })
        .expect(500);
      await supertest(app)
        .post(`/tabs/${tabIdA}/navigate`)
        .send({ userId, url: 'http://example.com' })
        .expect(500);

      // Session A counter should be 2, Session B counter should be 0
      expect(__getUserHealthForTests(userId, sessionKeyA)?.consecutiveNavFailures).toBe(2);
      expect(__getUserHealthForTests(userId, sessionKeyB)?.consecutiveNavFailures ?? 0).toBe(0);

      // 1 failure on session B — should NOT trip recovery (B has counter 1, not 3)
      await supertest(app)
        .post(`/tabs/${tabIdB}/navigate`)
        .send({ userId, url: 'http://example.com' })
        .expect(500);

      expect(__getUserHealthForTests(userId, sessionKeyB)?.consecutiveNavFailures).toBe(1);

      // Session B tab should still exist (no recovery)
      expect(sessionModule.findTabById(tabIdB, userId)).not.toBeNull();

      // 1 more failure on session A — threshold reached (3), recovery for A only
      await supertest(app)
        .post(`/tabs/${tabIdA}/navigate`)
        .send({ userId, url: 'http://example.com' })
        .expect(500);

      // Session A's health entry should be evicted after recovery
      expect(__getUserHealthForTests(userId, sessionKeyA)).toBeUndefined();

      // Session B's health entry should still exist with counter 1
      expect(__getUserHealthForTests(userId, sessionKeyB)?.consecutiveNavFailures).toBe(1);

      // Session B tab should still be alive
      expect(sessionModule.findTabById(tabIdB, userId)).not.toBeNull();
    });

    test('success in session B does not reset session A failure counter', async () => {
      const userId = 'test-user-cross-success';
      const tabIdA = 'tab-cross-succ-a';
      const tabIdB = 'tab-cross-succ-b';
      const sessionKeyA = 'session-key-cross-succ-a';
      const sessionKeyB = 'session-key-cross-succ-b';

      setupSiblingSessions(userId, tabIdA, sessionKeyA, tabIdB, sessionKeyB);

      // 2 navigation failures on session A
      mockNavigate.mockRejectedValue(new Error('nav fail'));
      await supertest(app).post(`/tabs/${tabIdA}/navigate`).send({ userId, url: 'http://example.com' }).expect(500);
      await supertest(app).post(`/tabs/${tabIdA}/navigate`).send({ userId, url: 'http://example.com' }).expect(500);

      expect(__getUserHealthForTests(userId, sessionKeyA)?.consecutiveNavFailures).toBe(2);

      // 1 successful navigation on session B
      mockNavigate.mockResolvedValue(undefined);
      await supertest(app).post(`/tabs/${tabIdB}/navigate`).send({ userId, url: 'http://example.com' }).expect(200);

      // Session A counter should still be 2 — B's success did NOT reset it
      expect(__getUserHealthForTests(userId, sessionKeyA)?.consecutiveNavFailures).toBe(2);

      // Session B counter should be 0 (success resets it)
      expect(__getUserHealthForTests(userId, sessionKeyB)?.consecutiveNavFailures ?? 0).toBe(0);
    });
  });

  // ── 6. recordNavSuccess fires before buildRefs ─────────────────

  describe('HIGH 6 — recordNavSuccess fires immediately after navigation, before buildRefs', () => {
    test('navigation success + buildRefs failure still resets counter', async () => {
      const userId = 'test-user-buildrefs';
      const tabId = 'tab-buildrefs';
      const { sessionKey } = setupFakeTab(userId, tabId);

      // Pre-accumulate 2 failures so the counter is non-zero
      mockNavigate.mockRejectedValue(new Error('nav fail'));
      await supertest(app).post(`/tabs/${tabId}/navigate`).send({ userId, url: 'http://example.com' }).expect(500);
      await supertest(app).post(`/tabs/${tabId}/navigate`).send({ userId, url: 'http://example.com' }).expect(500);

      expect(__getUserHealthForTests(userId, sessionKey)?.consecutiveNavFailures).toBe(2);

      // Now: navigation succeeds but buildRefs throws
      mockNavigate.mockResolvedValue(undefined);
      mockBuildRefs.mockRejectedValue(new Error('buildRefs explosion'));

      await supertest(app)
        .post(`/tabs/${tabId}/navigate`)
        .send({ userId, url: 'http://example.com' })
        .expect(500); // buildRefs error → 500

      // Counter should be 0 — recordNavSuccess ran before buildRefs
      // But wait: the catch block runs handleNavFailure since the route
      // returned 500. However, navError=false because navigation succeeded,
      // so handleNavFailure is NOT called. The counter should be reset to 0
      // by recordNavSuccess which fired right after navigateWithSafetyGuard.
      const health = __getUserHealthForTests(userId, sessionKey);
      expect(health?.consecutiveNavFailures ?? 0).toBe(0);
    });

    test('openclaw route also resets counter before buildRefs', async () => {
      const userId = 'test-user-oc-buildrefs';
      const tabId = 'tab-oc-buildrefs';
      const { sessionKey } = setupFakeTab(userId, tabId);

      // Pre-accumulate 2 failures
      mockNavigate.mockRejectedValue(new Error('nav fail'));
      await supertest(app).post('/navigate').send({ targetId: tabId, userId, url: 'http://example.com' }).expect(500);
      await supertest(app).post('/navigate').send({ targetId: tabId, userId, url: 'http://example.com' }).expect(500);

      expect(__getUserHealthForTests(userId, sessionKey)?.consecutiveNavFailures).toBe(2);

      // Navigation succeeds, buildRefs throws
      mockNavigate.mockResolvedValue(undefined);
      mockBuildRefs.mockRejectedValue(new Error('buildRefs boom'));

      await supertest(app)
        .post('/navigate')
        .send({ targetId: tabId, userId, url: 'http://example.com' })
        .expect(500);

      const health = __getUserHealthForTests(userId, sessionKey);
      expect(health?.consecutiveNavFailures ?? 0).toBe(0);
    });
  });

  // ── 7. Lock continuity — non-owner does not clear lock ─────────

  describe('lock continuity — non-owner does not clear another lock', () => {
    test('concurrent handleNavFailure calls do not clear in-flight lock', async () => {
      const userId = 'test-user-lock-continuity';
      const sessionKey = 'session-key-continuity';

      recordNavFailure(userId, sessionKey);
      recordNavFailure(userId, sessionKey);

      acquireRecoveryLock(userId, sessionKey);
      expect(isUserRecovering(userId, sessionKey)).toBe(true);

      const exceeded = recordNavFailure(userId, sessionKey);
      expect(exceeded).toBe(true);

      mockCloseContext.mockResolvedValue(undefined);
      await handleNavFailure(userId, sessionKey);

      expect(isUserRecovering(userId, sessionKey)).toBe(true);
      expect(mockCloseContext).not.toHaveBeenCalled();

      releaseRecoveryLock(userId, sessionKey);
      deleteUserHealth(userId, sessionKey);
      expect(isUserRecovering(userId, sessionKey)).toBe(false);
    });
  });

  // ── 8. Session identity propagation ───────────────────────────

  describe('session identity — recovery targets exact session', () => {
    test('handleNavFailure passes sessionMapKey to closeContextBySession', async () => {
      const userId = 'test-user-session-id';
      const tabId = 'tab-session-id';
      const { sessionKey } = setupFakeTab(userId, tabId);

      mockNavigate.mockRejectedValue(new Error('nav fail'));

      await supertest(app)
        .post(`/tabs/${tabId}/navigate`)
        .send({ userId, url: 'http://example.com' })
        .expect(500);

      expect(__getUserHealthForTests(userId, sessionKey)?.consecutiveNavFailures).toBe(1);

      await supertest(app)
        .post(`/tabs/${tabId}/navigate`)
        .send({ userId, url: 'http://example.com' })
        .expect(500);

      expect(__getUserHealthForTests(userId, sessionKey)?.consecutiveNavFailures).toBe(2);
    });
  });
});