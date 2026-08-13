import { log } from '../middleware/logging';
import { loadConfig } from '../utils/config';

export interface HealthState {
	consecutiveNavFailures: number;
	lastSuccessfulNav: number;
	isRecovering: boolean;
	activeOps: number;
}

/**
 * Per-session navigation health tracking.
 *
 * Each session gets an independent failure counter and recovery state.
 * This prevents interleaved failures from different sessions triggering
 * recovery for the wrong session, and a success from one session resetting
 * the failure count for another.
 *
 * When no session identity is available (legacy callers), a user-wide
 * key is used as fallback so those callers still get health tracking.
 */
interface SessionNavHealth {
	consecutiveNavFailures: number;
	lastSuccessfulNav: number;
	recovering: boolean;
}

const CONFIG = loadConfig();

// Per-session health map. Lazily populated — a session's entry is created
// on first failure or success. Keyed by sessionMapKey when available,
// falling back to userId for legacy callers without session identity.
const sessionHealthMap = new Map<string, SessionNavHealth>();

// Process-global health state — kept for compatibility with the
// health probe in server.js (lastSuccessfulNav, activeOps, isRecovering).
// isRecovering is now true if ANY session is recovering.
const healthState: HealthState = {
	consecutiveNavFailures: 0,
	lastSuccessfulNav: Date.now(),
	isRecovering: false,
	activeOps: 0,
};

/**
 * Compute the health key for a given userId/sessionKey pair.
 * When sessionKey is provided, use it directly — this isolates
 * per-session counters. When absent, fall back to userId for
 * legacy callers.
 */
function healthKey(userId: string, sessionKey?: string): string {
	if (sessionKey !== undefined && sessionKey !== null && sessionKey !== '') {
		return String(sessionKey);
	}
	return String(userId);
}

function getSessionHealth(userId: string, sessionKey?: string): SessionNavHealth {
	const key = healthKey(userId, sessionKey);
	let h = sessionHealthMap.get(key);
	if (!h) {
		h = {
			consecutiveNavFailures: 0,
			lastSuccessfulNav: Date.now(),
			recovering: false,
		};
		sessionHealthMap.set(key, h);
	}
	return h;
}

export function getHealthState(): Readonly<HealthState> {
	// Aggregate per-session state into the process-global view.
	let totalFailures = 0;
	let anyRecovering = false;
	let latestNav = healthState.lastSuccessfulNav;
	for (const h of sessionHealthMap.values()) {
		totalFailures += h.consecutiveNavFailures;
		if (h.recovering) anyRecovering = true;
		if (h.lastSuccessfulNav > latestNav) latestNav = h.lastSuccessfulNav;
	}
	healthState.consecutiveNavFailures = totalFailures;
	healthState.isRecovering = anyRecovering;
	healthState.lastSuccessfulNav = latestNav;
	return healthState;
}

/**
 * Records a navigation success for a specific session.
 * Resets only that session's failure counter.
 */
export function recordNavSuccess(userId: string, sessionKey?: string): void {
	const h = getSessionHealth(userId, sessionKey);
	h.consecutiveNavFailures = 0;
	h.lastSuccessfulNav = Date.now();
	healthState.lastSuccessfulNav = h.lastSuccessfulNav;
}

/**
 * Records a navigation failure for a specific session.
 * Returns true when that session's consecutive failures exceed the
 * threshold, signaling the caller to recover that session's browser context.
 */
export function recordNavFailure(userId: string, sessionKey?: string): boolean {
	const h = getSessionHealth(userId, sessionKey);
	h.consecutiveNavFailures++;
	const exceeded = h.consecutiveNavFailures >= CONFIG.failureThreshold;
	if (exceeded) {
		log('error', 'consecutive navigation failures exceeded threshold', {
			userId,
			sessionKey: sessionKey ?? null,
			consecutiveFailures: h.consecutiveNavFailures,
			failureThreshold: CONFIG.failureThreshold,
		});
	}
	return exceeded;
}

/**
 * Attempts to acquire the single-flight recovery lock for a session.
 * Returns true if acquired (caller should proceed with recovery),
 * false if a recovery for this session is already in flight.
 */
export function acquireRecoveryLock(userId: string, sessionKey?: string): boolean {
	const h = getSessionHealth(userId, sessionKey);
	if (h.recovering) return false;
	h.recovering = true;
	return true;
}

/**
 * Releases the single-flight recovery lock for a session.
 * Resets that session's failure counter — recovery was attempted, so
 * the next batch of failures starts fresh.
 */
export function releaseRecoveryLock(userId: string, sessionKey?: string): void {
	const h = getSessionHealth(userId, sessionKey);
	h.recovering = false;
	h.consecutiveNavFailures = 0;
}

/**
 * Checks whether a session is currently recovering.
 */
export function isUserRecovering(userId: string, sessionKey?: string): boolean {
	const key = healthKey(userId, sessionKey);
	const h = sessionHealthMap.get(key);
	return h?.recovering ?? false;
}

export function incrementActiveOps(): void {
	healthState.activeOps++;
}

export function decrementActiveOps(): void {
	healthState.activeOps = Math.max(0, healthState.activeOps - 1);
}

export function setRecovering(value: boolean): void {
	healthState.isRecovering = value;
}

export function resetHealth(): void {
	sessionHealthMap.clear();
	healthState.consecutiveNavFailures = 0;
	healthState.lastSuccessfulNav = Date.now();
	healthState.isRecovering = false;
	healthState.activeOps = 0;
}

/**
 * Evicts a session's health entry from the map. Called after recovery
 * completes to prevent the map from growing unbounded over the
 * process lifetime. Safe to call even if the session has no entry.
 *
 * Preserves entries where `recovering === true`: ordinary session
 * cleanup (timeout, explicit close, bulk close) must not evict a
 * health entry while an in-flight recovery holds the lock, otherwise
 * a concurrent request can recreate the entry and acquire a second
 * recovery lock. The lock owner's `finally` block in
 * `handleNavFailure` is the sole eviction path while recovering.
 */
export function deleteUserHealth(userId: string, sessionKey?: string): void {
	const key = healthKey(userId, sessionKey);
	const h = sessionHealthMap.get(key);
	if (h?.recovering) return;
	sessionHealthMap.delete(key);
}

// ── Test-only exports ──────────────────────────────────────────────
// These allow unit tests to inspect and manipulate the per-session health
// map without relying on the process-global aggregate. Not part of the
// public API.
export function __getUserHealthForTests(userId: string, sessionKey?: string): SessionNavHealth | undefined {
	const key = healthKey(userId, sessionKey);
	return sessionHealthMap.get(key);
}

export function __clearUserHealthForTests(): void {
	sessionHealthMap.clear();
}