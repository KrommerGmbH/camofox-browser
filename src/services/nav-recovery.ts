import { log } from '../middleware/logging';
import { recordNavFailure, acquireRecoveryLock, releaseRecoveryLock, deleteUserHealth } from './health';
import { contextPool } from './context-pool';

/**
 * Record a navigation failure for a specific session and recover
 * that session's browser context when the consecutive failure threshold
 * is exceeded.
 *
 * Session-scoped: recovery targets the specific session/profile that had
 * the navigation failure, so one failing tab never terminates unrelated
 * sessions for the same user. When `sessionMapKey` is unavailable, falls
 * back to closing all of the user's contexts (backward compatible).
 *
 * Per-session: health accounting and the single-flight lock are keyed by
 * sessionMapKey when available (independent failure counters per session).
 * When no session key is present, falls back to userId-wide keying.
 *
 * Lock ownership: `releaseRecoveryLock` and `deleteUserHealth` are
 * called **only** by the invocation that acquired the lock. This
 * prevents a below-threshold or non-owner early return from clearing
 * a counter or lock owned by another in-flight request.
 *
 * Safe to call from route catch blocks: best-effort, never throws.
 */
export async function handleNavFailure(userId: string, sessionMapKey?: string): Promise<void> {
	let lockAcquired = false;
	try {
		if (!userId) return;
		const exceeded = recordNavFailure(userId, sessionMapKey);
		if (!exceeded) return;
		// Single-flight: skip if a recovery for this session is already running.
		if (!acquireRecoveryLock(userId, sessionMapKey)) {
			log('info', 'nav failure threshold exceeded, recovery already in flight', {
				userId,
				sessionMapKey: sessionMapKey ?? null,
			});
			return;
		}
		lockAcquired = true;
		log('info', 'nav failure threshold exceeded, recovering browser context', {
			userId,
			sessionMapKey: sessionMapKey ?? null,
		});
		await contextPool.closeContextBySession(userId, sessionMapKey);
	} catch {
		// Best-effort recovery — never propagate
	} finally {
		if (lockAcquired) {
			releaseRecoveryLock(userId, sessionMapKey);
			// Evict the session's health entry after recovery so the map
			// doesn't grow unbounded over the process lifetime.
			deleteUserHealth(userId, sessionMapKey);
		}
	}
}