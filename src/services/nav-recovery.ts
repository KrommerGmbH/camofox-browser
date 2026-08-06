import { log } from '../middleware/logging';
import { recordNavFailure, acquireRecoveryLock, releaseRecoveryLock, deleteUserHealth } from './health';
import { contextPool } from './context-pool';

/**
 * Record a navigation failure for a specific user and recover their
 * browser context when the consecutive failure threshold is exceeded.
 *
 * Per-user: only the failing user's context is closed. Single-flight:
 * if a recovery for this user is already in flight, subsequent
 * failures are recorded but do not trigger a second recovery.
 *
 * Lock ownership: `releaseRecoveryLock` and `deleteUserHealth` are
 * called **only** by the invocation that acquired the lock. This
 * prevents a below-threshold or non-owner early return from clearing
 * a counter or lock owned by another in-flight request.
 *
 * Safe to call from route catch blocks: best-effort, never throws.
 */
export async function handleNavFailure(userId: string): Promise<void> {
	let lockAcquired = false;
	try {
		if (!userId) return;
		const exceeded = recordNavFailure(userId);
		if (!exceeded) return;
		// Single-flight: skip if a recovery for this user is already running.
		if (!acquireRecoveryLock(userId)) {
			log('info', 'nav failure threshold exceeded, recovery already in flight', { userId });
			return;
		}
		lockAcquired = true;
		log('info', 'nav failure threshold exceeded, recovering browser context', { userId });
		await contextPool.closeContextByUserId(userId);
	} catch {
		// Best-effort recovery — never propagate
	} finally {
		if (lockAcquired) {
			releaseRecoveryLock(userId);
			// Evict the user's health entry after recovery so the map
			// doesn't grow unbounded over the process lifetime.
			deleteUserHealth(userId);
		}
	}
}