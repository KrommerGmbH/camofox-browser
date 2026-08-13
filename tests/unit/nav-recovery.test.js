/**
 * Route-level tests for handleNavFailure in nav-recovery.ts.
 *
 * These tests exercise the actual handleNavFailure function (not just
 * the health module) with mocked contextPool.closeContextBySession.
 * They verify the lock-ownership fix and the four scenarios the
 * maintainer requested:
 *
 * 1. Below-threshold failures accumulate (counter not reset by finally)
 * 2. Threshold-triggered close counts (closeContextBySession called once)
 * 3. Concurrent non-owner behavior (non-owner does not clear another's lock)
 * 4. Recovery failure cleanup (lock released + health evicted on failure)
 *
 * Additional tests for session-scoped recovery (PR #27 round 2):
 * 5. sessionMapKey passed through to closeContextBySession
 * 6. No sessionMapKey falls back to user-wide close (backward compat)
 *
 * No running server or browser is required — contextPool is mocked.
 */

// ── Mocks ───────────────────────────────────────────────────────────

const mockCloseContextBySession = jest.fn();

jest.mock('../../dist/src/services/context-pool', () => ({
  contextPool: {
    closeContextBySession: mockCloseContextBySession,
  },
}));

jest.mock('../../dist/src/middleware/logging', () => ({
  log: jest.fn(),
}));

jest.mock('../../dist/src/utils/config', () => ({
  loadConfig: jest.fn(() => ({
    failureThreshold: 3,
    maxSessions: 10,
    maxConcurrentPerUser: 5,
    handlerTimeoutMs: 30000,
  })),
}));

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

// ── Test suite ──────────────────────────────────────────────────────

describe('handleNavFailure — route-level lock ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __clearUserHealthForTests();
    resetHealth();
  });

  afterEach(() => {
    __clearUserHealthForTests();
    resetHealth();
  });

  // ── 1. Below-threshold accumulation ────────────────────────────

  describe('below-threshold failures accumulate', () => {
    test('two below-threshold failures do not reset the counter', async () => {
      // First failure (below threshold) — should NOT reset counter
      await handleNavFailure('user-a');
      expect(__getUserHealthForTests('user-a').consecutiveNavFailures).toBe(1);

      // Second failure (still below threshold) — counter should be 2
      await handleNavFailure('user-a');
      expect(__getUserHealthForTests('user-a').consecutiveNavFailures).toBe(2);

      // closeContextByUserId should NOT have been called
      expect(mockCloseContextBySession).not.toHaveBeenCalled();
    });

    test('third failure reaches threshold and triggers recovery', async () => {
      // Two below-threshold failures
      await handleNavFailure('user-a');
      await handleNavFailure('user-a');
      expect(mockCloseContextBySession).not.toHaveBeenCalled();

      // Third failure — threshold reached
      mockCloseContextBySession.mockResolvedValue(undefined);
      await handleNavFailure('user-a');
      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);
      expect(mockCloseContextBySession).toHaveBeenCalledWith('user-a', undefined);
    });

    test('success between failures resets counter (normal operation)', async () => {
      await handleNavFailure('user-a');
      await handleNavFailure('user-a');
      expect(__getUserHealthForTests('user-a').consecutiveNavFailures).toBe(2);

      // A successful navigation resets the counter
      recordNavSuccess('user-a');
      expect(__getUserHealthForTests('user-a').consecutiveNavFailures).toBe(0);

      // Two more failures should not trigger recovery
      await handleNavFailure('user-a');
      await handleNavFailure('user-a');
      expect(mockCloseContextBySession).not.toHaveBeenCalled();
    });
  });

  // ── 2. Threshold-triggered close counts ───────────────────────

  describe('threshold-triggered close counts', () => {
    test('closeContextByUserId called exactly once at threshold', async () => {
      mockCloseContextBySession.mockResolvedValue(undefined);

      for (let i = 0; i < 3; i++) {
        await handleNavFailure('user-a');
      }

      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);
    });

    test('recovery resets counter, next batch starts fresh', async () => {
      mockCloseContextBySession.mockResolvedValue(undefined);

      // First cycle: 3 failures → recovery
      for (let i = 0; i < 3; i++) {
        await handleNavFailure('user-a');
      }
      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);

      // After recovery, the user's health entry is evicted.
      // Two more failures should NOT trigger recovery (need 3 again).
      await handleNavFailure('user-a');
      await handleNavFailure('user-a');
      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);

      // Third failure triggers recovery again
      await handleNavFailure('user-a');
      expect(mockCloseContextBySession).toHaveBeenCalledTimes(2);
    });

    test('different users have independent thresholds', async () => {
      mockCloseContextBySession.mockResolvedValue(undefined);

      // 3 failures for user-a → recovery
      for (let i = 0; i < 3; i++) {
        await handleNavFailure('user-a');
      }
      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);
      expect(mockCloseContextBySession).toHaveBeenLastCalledWith('user-a', undefined);

      // 2 failures for user-b → no recovery yet
      await handleNavFailure('user-b');
      await handleNavFailure('user-b');
      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);

      // 3rd failure for user-b → recovery
      await handleNavFailure('user-b');
      expect(mockCloseContextBySession).toHaveBeenCalledTimes(2);
      expect(mockCloseContextBySession).toHaveBeenLastCalledWith('user-b', undefined);
    });
  });

  // ── 3. Concurrent non-owner behavior ─────────────────────────

  describe('concurrent non-owner behavior', () => {
    test('non-owner does not clear another request lock', async () => {
      // Simulate: request A acquires lock and is mid-recovery.
      // Request B hits threshold, tries to acquire lock, fails,
      // and must NOT release A's lock via finally.

      // Pre-populate user-a with 2 failures
      recordNavFailure('user-a');
      recordNavFailure('user-a');

      // Request A acquires the recovery lock
      expect(acquireRecoveryLock('user-a')).toBe(true);
      expect(isUserRecovering('user-a')).toBe(true);

      // Now request B calls handleNavFailure for the same user.
      // recordNavFailure will increment to 3 (threshold exceeded),
      // but acquireRecoveryLock will return false (A has it).
      // B's finally must NOT call releaseRecoveryLock.
      mockCloseContextBySession.mockResolvedValue(undefined);
      await handleNavFailure('user-a');

      // closeContextByUserId should NOT be called by B
      expect(mockCloseContextBySession).not.toHaveBeenCalled();

      // A's lock should still be held
      expect(isUserRecovering('user-a')).toBe(true);

      // A's counter should be 3 (incremented by B, NOT reset by B's finally)
      expect(__getUserHealthForTests('user-a').consecutiveNavFailures).toBe(3);

      // A finishes recovery and releases the lock
      releaseRecoveryLock('user-a');
      deleteUserHealth('user-a');
      expect(isUserRecovering('user-a')).toBe(false);
    });

    test('concurrent failures from different users do not interfere', async () => {
      mockCloseContextBySession.mockResolvedValue(undefined);

      // Interleave failures: a, b, a, b, a
      // A should trigger on its 3rd call; B should not trigger
      await handleNavFailure('a'); // a=1
      await handleNavFailure('b'); // b=1
      await handleNavFailure('a'); // a=2
      await handleNavFailure('b'); // b=2

      // A's 3rd failure — triggers recovery for A only
      await handleNavFailure('a'); // a=3 → threshold

      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);
      expect(mockCloseContextBySession).toHaveBeenCalledWith('a', undefined);

      // B is at 2, no recovery
      expect(__getUserHealthForTests('b').consecutiveNavFailures).toBe(2);
    });
    test('empty userId is a no-op (does not create health entry)', async () => {
      await handleNavFailure('');
      expect(mockCloseContextBySession).not.toHaveBeenCalled();
      expect(__getUserHealthForTests('')).toBeUndefined();
    });
  });

  // ── 4. Recovery failure cleanup ───────────────────────────────

  describe('recovery failure cleanup', () => {
    test('lock released and health evicted when closeContextByUserId throws', async () => {
      mockCloseContextBySession.mockRejectedValue(new Error('close failed'));

      // 3 failures → threshold → recovery fails
      await handleNavFailure('user-a');
      await handleNavFailure('user-a');
      await handleNavFailure('user-a');

      // Recovery was attempted (closeContextByUserId called)
      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);

      // Lock should be released (not stuck in recovering state)
      expect(isUserRecovering('user-a')).toBe(false);

      // Health entry should be evicted (map cleanup)
      expect(__getUserHealthForTests('user-a')).toBeUndefined();

      // User can trigger recovery again with fresh failures
      await handleNavFailure('user-a');
      await handleNavFailure('user-a');
      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);

      mockCloseContextBySession.mockResolvedValue(undefined);
      await handleNavFailure('user-a');
      expect(mockCloseContextBySession).toHaveBeenCalledTimes(2);
    });

    test('successful recovery evicts health entry', async () => {
      mockCloseContextBySession.mockResolvedValue(undefined);

      for (let i = 0; i < 3; i++) {
        await handleNavFailure('user-a');
      }

      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);
      // After successful recovery, health entry is evicted
      expect(__getUserHealthForTests('user-a')).toBeUndefined();
    });

    test('lock is not released when not acquired (below threshold)', async () => {
      // Pre-acquire the lock (simulating another in-flight recovery)
      acquireRecoveryLock('user-a');

      // Two below-threshold failures — neither should trigger recovery
      // nor release the pre-existing lock
      await handleNavFailure('user-a');
      await handleNavFailure('user-a');

      expect(mockCloseContextBySession).not.toHaveBeenCalled();
      // Lock should still be held by the original acquirer
      expect(isUserRecovering('user-a')).toBe(true);

      // Clean up
      releaseRecoveryLock('user-a');
    });
  });

  // ── 5. Session-scoped recovery ──────────────────────────────

  describe('session-scoped recovery (PR #27 round 2)', () => {
    test('sessionMapKey is passed through to closeContextBySession', async () => {
      mockCloseContextBySession.mockResolvedValue(undefined);

      for (let i = 0; i < 3; i++) {
        await handleNavFailure('user-a', 'session-key-1');
      }

      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);
      expect(mockCloseContextBySession).toHaveBeenCalledWith('user-a', 'session-key-1');
    });

    test('different session keys have independent health counters', async () => {
      mockCloseContextBySession.mockResolvedValue(undefined);

      // Health counters are now per-session (keyed by sessionMapKey).
      // Failures from session-1 and session-2 accumulate independently.
      await handleNavFailure('user-a', 'session-1');
      await handleNavFailure('user-a', 'session-2');
      // Each session has counter=1, neither has hit threshold (3)
      expect(__getUserHealthForTests('user-a', 'session-1').consecutiveNavFailures).toBe(1);
      expect(__getUserHealthForTests('user-a', 'session-2').consecutiveNavFailures).toBe(1);
      expect(mockCloseContextBySession).not.toHaveBeenCalled();

      // Two more failures on session-1 → threshold reached → recovery for session-1
      await handleNavFailure('user-a', 'session-1');
      await handleNavFailure('user-a', 'session-1');

      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);
      expect(mockCloseContextBySession).toHaveBeenLastCalledWith('user-a', 'session-1');

      // Session-2 counter is still 1 — unaffected by session-1's recovery
      expect(__getUserHealthForTests('user-a', 'session-2').consecutiveNavFailures).toBe(1);
    });

    test('no sessionMapKey falls back to user-wide close (backward compat)', async () => {
      mockCloseContextBySession.mockResolvedValue(undefined);

      for (let i = 0; i < 3; i++) {
        await handleNavFailure('user-a');
      }

      expect(mockCloseContextBySession).toHaveBeenCalledTimes(1);
      // Second arg is undefined — closeContextBySession falls back to user-wide
      expect(mockCloseContextBySession).toHaveBeenCalledWith('user-a', undefined);
    });
  });
});