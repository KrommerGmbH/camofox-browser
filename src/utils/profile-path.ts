import { createHash } from 'node:crypto';
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
