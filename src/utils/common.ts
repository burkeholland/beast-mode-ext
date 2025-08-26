/**
 * Pure utility functions for common operations
 */

/**
 * Generate a cryptographically secure nonce
 */
export function generateNonce(length = 32): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	return Array.from({ length }, () => 
		chars.charAt(Math.floor(Math.random() * chars.length))
	).join('');
}

/**
 * Create a safe filename from a URL
 */
export function createSafeFilename(url: string, prefix = '', suffix = ''): string {
	const urlHash = Buffer.from(url)
		.toString('base64')
		.replace(/[^a-zA-Z0-9]/g, '')
		.substring(0, 32);
	return `${prefix}${urlHash}${suffix}`;
}

/**
 * Parse JSON safely with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
	try {
		return JSON.parse(json);
	} catch {
		return fallback;
	}
}

/**
 * Execute async function with error suppression
 */
export async function ignoreErrors<T>(fn: () => Promise<T>): Promise<T | null> {
	try {
		return await fn();
	} catch {
		return null;
	}
}

/**
 * Execute sync function with error suppression
 */
export function ignoreErrorsSync<T>(fn: () => T): T | null {
	try {
		return fn();
	} catch {
		return null;
	}
}

/**
 * Check if URL is valid HTTP/HTTPS
 */
export function isValidHttpUrl(url: string): boolean {
	return /^https?:\/\//i.test(url);
}

/**
 * Extract Gist ID from GitHub URL
 */
export function extractGistId(url: string): string | null {
	const match = url.match(/gist\.github\.com\/(?:[^\/]+\/)?([0-9a-fA-F]{6,})/i);
	return match?.[1] || null;
}

/**
 * Compare values for equality based on type
 */
export function compareValues(
	current: any, 
	target: any, 
	type: 'boolean' | 'number' | 'string' | 'json'
): boolean {
	if (current === undefined || current === null) {
		return target === undefined || target === null;
	}

	switch (type) {
		case 'boolean':
			return Boolean(current) === Boolean(target);
		case 'number':
			return Number(current) === Number(target);
		case 'string':
			return String(current) === String(target);
		case 'json':
			return JSON.stringify(current) === JSON.stringify(target);
		default:
			return current === target;
	}
}