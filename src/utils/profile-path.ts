import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function decodeDefaultProfileUserId(profileKey: string): string | null {
	if (!profileKey.startsWith('u:') || profileKey.indexOf(':', 2) !== -1) return null;
	try {
		const encoded = profileKey.slice(2);
		const bytes = Buffer.from(encoded, 'base64url');
		if (bytes.length % 2 !== 0) return null;
		const decoded = bytes.toString('utf16le');
		if (/^(?:u|s|p|o):/.test(decoded)) return null;
		for (let i = 0; i < decoded.length; i += 1) {
			const code = decoded.charCodeAt(i);
			if (code >= 0xd800 && code <= 0xdbff) {
				if (i + 1 >= decoded.length) return null;
				const next = decoded.charCodeAt(i + 1);
				if (next < 0xdc00 || next > 0xdfff) return null;
				i += 1;
			} else if (code >= 0xdc00 && code <= 0xdfff) {
				return null;
			}
		}
		return `u:${Buffer.from(decoded, 'utf16le').toString('base64url')}` === profileKey ? decoded : null;
	} catch {
		return null;
	}
}

function internalProfileDirectoryName(profileKey: string): string {
	const digest = createHash('sha256').update(profileKey, 'utf8').digest('hex');
	return `profile-${digest}`;
}

export function profileDirForProfileKey(
	profilesDir: string,
	profileKey: string,
	platform: NodeJS.Platform = process.platform,
): string {
	const normalized = String(profileKey);
	const defaultUserId = decodeDefaultProfileUserId(normalized);
	const isInternalProfileKey = /^(?:u|s|p|o):/.test(normalized);
	const basename = isInternalProfileKey && platform === 'win32'
		? internalProfileDirectoryName(normalized)
		: defaultUserId !== null
			? encodeURIComponent(defaultUserId)
			: encodeURIComponent(normalized);
	return path.join(profilesDir, basename);
}

export function previousProfileDirForProfileKey(
	profilesDir: string,
	profileKey: string,
	platform: NodeJS.Platform = process.platform,
): string | null {
	if (platform !== 'win32') return null;

	const normalized = String(profileKey);
	if (!/^(?:u|s|p|o):/.test(normalized)) return null;

	const defaultUserId = decodeDefaultProfileUserId(normalized);
	const legacyBasename = encodeURIComponent(defaultUserId ?? normalized);
	const legacyDir = path.join(profilesDir, legacyBasename);
	const currentDir = profileDirForProfileKey(profilesDir, normalized, platform);
	return legacyDir === currentDir ? null : legacyDir;
}

interface ProfilePathFileSystem {
	existsSync(candidate: string): boolean;
	readdirSync(directory: string): string[];
}

const profilePathFileSystem: ProfilePathFileSystem = {
	existsSync: (candidate) => fs.existsSync(candidate),
	readdirSync: (directory) => fs.readdirSync(directory),
};

export function resolveProfileDirForProfileKey(
	profilesDir: string,
	profileKey: string,
	platform: NodeJS.Platform = process.platform,
	fileSystem: ProfilePathFileSystem = profilePathFileSystem,
): string {
	const currentDir = profileDirForProfileKey(profilesDir, profileKey, platform);
	const previousDir = previousProfileDirForProfileKey(profilesDir, profileKey, platform);
	if (!previousDir) return currentDir;

	const currentExists = fileSystem.existsSync(currentDir);
	const previousExists = fileSystem.existsSync(previousDir);
	if (!previousExists) return currentDir;

	const previousBasename = path.basename(previousDir);
	let exactPreviousNameExists = false;
	try {
		exactPreviousNameExists = fileSystem.readdirSync(path.dirname(previousDir)).includes(previousBasename);
	} catch (err) {
		throw new Error(
			`Cannot inspect the previous Windows profile directory for "${profileKey}": ${previousDir}. ` +
			`Refusing to choose profile state automatically: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (!exactPreviousNameExists) {
		throw new Error(
			`The previous Windows profile path for "${profileKey}" resolves to existing state, but its exact on-disk ` +
			`directory name does not match "${previousBasename}". This can indicate a case or trailing-dot/space alias. ` +
			`Refusing to reuse ambiguous profile state. Back up ${path.dirname(previousDir)} and keep the intended profile ` +
			`under exactly one unambiguous directory before retrying.`,
		);
	}

	if (currentExists) {
		throw new Error(
			`Cannot choose profile state for "${profileKey}" because both the current and previous Windows profile directories exist. ` +
			`Current: ${currentDir}. Previous: ${previousDir}. Back up both directories, then retain the intended state ` +
			`at exactly one of these paths before retrying.`,
		);
	}

	return previousDir;
}
