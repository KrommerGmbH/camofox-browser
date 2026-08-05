import { log } from '../middleware/logging';
import { loadConfig } from '../utils/config';

export interface HealthState {
	consecutiveNavFailures: number;
	lastSuccessfulNav: number;
	isRecovering: boolean;
	activeOps: number;
}

/**
 * Per-user navigation health tracking.
 *
 * Each user gets an independent failure counter and recovery state.
 * This prevents interleaved failures from different users triggering
 * recovery for the wrong user, and a success from one user resetting
 * the failure count for another.
 */
interface UserNavHealth {
	consecutiveNavFailures: number;
	lastSuccessfulNav: number;
	recovering: boolean;
}

const CONFIG = loadConfig();

// Per-user health map. Lazily populated — a user's entry is created
// on first failure or success. Entries are never deleted (small map,
// bounded by the number of active users).
const userHealthMap = new Map<string, UserNavHealth>();

// Process-global health state — kept for compatibility with the
// health probe in server.js (lastSuccessfulNav, activeOps, isRecovering).
// isRecovering is now true if ANY user is recovering.
const healthState: HealthState = {
	consecutiveNavFailures: 0,
	lastSuccessfulNav: Date.now(),
	isRecovering: false,
	activeOps: 0,
};

function getUserHealth(userId: string): UserNavHealth {
	let h = userHealthMap.get(userId);
	if (!h) {
		h = {
			consecutiveNavFailures: 0,
			lastSuccessfulNav: Date.now(),
			recovering: false,
		};
		userHealthMap.set(userId, h);
	}
	return h;
}

export function getHealthState(): Readonly<HealthState> {
	// Aggregate per-user state into the process-global view.
	let totalFailures = 0;
	let anyRecovering = false;
	let latestNav = healthState.lastSuccessfulNav;
	for (const h of userHealthMap.values()) {
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
 * Records a navigation success for a specific user.
 * Resets only that user's failure counter.
 */
export function recordNavSuccess(userId: string): void {
	const h = getUserHealth(userId);
	h.consecutiveNavFailures = 0;
	h.lastSuccessfulNav = Date.now();
	healthState.lastSuccessfulNav = h.lastSuccessfulNav;
}

/**
 * Records a navigation failure for a specific user.
 * Returns true when that user's consecutive failures exceed the
 * threshold, signaling the caller to recover that user's browser context.
 */
export function recordNavFailure(userId: string): boolean {
	const h = getUserHealth(userId);
	h.consecutiveNavFailures++;
	const exceeded = h.consecutiveNavFailures >= CONFIG.failureThreshold;
	if (exceeded) {
		log('error', 'consecutive navigation failures exceeded threshold', {
			userId,
			consecutiveFailures: h.consecutiveNavFailures,
			failureThreshold: CONFIG.failureThreshold,
		});
	}
	return exceeded;
}

/**
 * Attempts to acquire the single-flight recovery lock for a user.
 * Returns true if acquired (caller should proceed with recovery),
 * false if a recovery for this user is already in flight.
 */
export function acquireRecoveryLock(userId: string): boolean {
	const h = getUserHealth(userId);
	if (h.recovering) return false;
	h.recovering = true;
	return true;
}

/**
 * Releases the single-flight recovery lock for a user.
 * Resets the user's failure counter — recovery was attempted, so
 * the next batch of failures starts fresh.
 */
export function releaseRecoveryLock(userId: string): void {
	const h = getUserHealth(userId);
	h.recovering = false;
	h.consecutiveNavFailures = 0;
}

/**
 * Checks whether a user is currently recovering.
 */
export function isUserRecovering(userId: string): boolean {
	const h = userHealthMap.get(userId);
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
	userHealthMap.clear();
	healthState.consecutiveNavFailures = 0;
	healthState.lastSuccessfulNav = Date.now();
	healthState.isRecovering = false;
	healthState.activeOps = 0;
}

// ── Test-only exports ──────────────────────────────────────────────
// These allow unit tests to inspect and manipulate the per-user health
// map without relying on the process-global aggregate. Not part of the
// public API.
export function __getUserHealthForTests(userId: string): UserNavHealth | undefined {
	return userHealthMap.get(userId);
}

export function __clearUserHealthForTests(): void {
	userHealthMap.clear();
}