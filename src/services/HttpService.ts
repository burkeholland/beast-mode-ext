import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { IHttpService, HttpRequestOptions, HttpResponse } from '../types';
import { Constants } from '../constants';
import { isValidHttpUrl, extractGistId, createSafeFilename, ignoreErrorsSync, safeJsonParse } from '../utils/common';

/**
 * HTTP service for making requests with caching and GitHub Gist support
 */
export class HttpService implements IHttpService {
	constructor(private readonly context: vscode.ExtensionContext) {}

	/**
	 * Make an HTTP GET request with optional caching
	 */
	async get(options: HttpRequestOptions): Promise<HttpResponse> {
		const { url, headers = {}, timeout = Constants.HTTP_TIMEOUT_MS, useCache = true } = options;

		// Check cache first if enabled
		const requestHeaders = { ...headers };
		if (useCache) {
			const prevEtag = this.getStoredEtag(url);
			if (prevEtag) {
				requestHeaders['If-None-Match'] = prevEtag;
			}
		}

		try {
			const response = await this.makeRequest(url, requestHeaders, timeout);

			// Handle 304 Not Modified
			if (response.status === 304 && useCache) {
				const cachedData = this.getCachedResponse(url);
				if (cachedData) {
					return {
						data: cachedData,
						headers: response.headers,
						status: 200,
						fromCache: true,
						etag: response.headers['etag']
					};
				}
			}

			if (response.status < 200 || response.status >= 300) {
				throw new Error(`HTTP ${response.status}: Failed to fetch ${url}`);
			}

			// Cache successful response
			if (useCache && response.data) {
				await this.storeResponse(url, response.data, response.headers['etag']);
			}

			return {
				data: response.data,
				headers: response.headers,
				status: response.status,
				fromCache: false,
				etag: response.headers['etag']
			};

		} catch (error) {
			// Try to return cached data on error
			if (useCache) {
				const cachedData = this.getCachedResponse(url);
				if (cachedData) {
					return {
						data: cachedData,
						headers: {},
						status: 200,
						fromCache: true
					};
				}
			}
			throw error;
		}
	}

	/**
	 * Fetch content from a GitHub Gist
	 */
	async fetchGistContent(gistId: string): Promise<string | null> {
		const apiUrl = `https://api.github.com/gists/${gistId}`;
		
		try {
			const response = await this.get({
				url: apiUrl,
				headers: { 'Accept': 'application/vnd.github.v3+json' },
				useCache: false
			});

			const parsed: any = safeJsonParse(response.data, {});
			const files = parsed?.files || {};
			
			// Look for config.json first, then any .json file
			let targetFile = files['config.json'];
			if (!targetFile) {
				const jsonFiles = Object.keys(files).filter(name => name.endsWith('.json'));
				if (jsonFiles.length > 0) {
					targetFile = files[jsonFiles[0]];
				}
			}

			return targetFile?.content || null;

		} catch {
			return null;
		}
	}

	/**
	 * Resolve a URL to its raw form, handling GitHub Gist URLs specially
	 */
	async resolveToRawUrl(url: string): Promise<string | null> {
		return this.resolveToRaw(url);
	}

	/**
	 * Fetch data from URL with caching (simplified interface)
	 */
	async fetch(url: string): Promise<string> {
		const response = await this.get({ url, useCache: true });
		return response.data;
	}

	/**
	 * Check if cached version is current
	 */
	async isCurrentVersion(url: string): Promise<boolean> {
		const storedEtag = this.getStoredEtag(url);
		if (!storedEtag) {return false;}

		try {
			const response = await this.get({ 
				url,
				headers: { 'If-None-Match': storedEtag },
				useCache: false
			});
			return response.status === 304;
		} catch {
			return false;
		}
	}

	private resolveToRaw(url: string): string | null {
		if (!url) {return null;}

		// GitHub raw URLs (keep as-is)
		if (url.includes('githubusercontent.com') && url.includes('/raw/')) {
			return url.split('#')[0];
		}

		// GitHub Gist URLs (convert to raw format)
		const gistId = extractGistId(url);
		if (gistId) {
			return `https://gist.githubusercontent.com/${gistId}/raw/config.json`;
		}

		// Regular URLs (strip hash)
		return url.split('#')[0];
	}

	private async makeRequest(url: string, headers: Record<string, string> = {}, timeout: number = Constants.HTTP_TIMEOUT_MS): Promise<{data: string, headers: Record<string, string>, status: number}> {
		if (!isValidHttpUrl(url)) {
			throw new Error('Invalid URL: must be HTTP or HTTPS');
		}

		const requestHeaders = {
			'User-Agent': Constants.USER_AGENT,
			'Accept': 'application/json',
			...headers
		};

		const urlObj = new URL(url);
		
		return new Promise((resolve, reject) => {
			const req = https.request({
				hostname: urlObj.hostname,
				path: urlObj.pathname + (urlObj.search || ''),
				method: 'GET',
				headers: requestHeaders,
				port: urlObj.port ? Number(urlObj.port) : 443,
				timeout
			}, (res) => {
				const chunks: Buffer[] = [];
				res.on('data', chunk => chunks.push(Buffer.from(chunk)));
				res.on('end', () => {
					resolve({
						data: Buffer.concat(chunks).toString('utf8'),
						headers: res.headers as Record<string, string>,
						status: res.statusCode || 500
					});
				});
			});

			req.on('error', reject);
			req.on('timeout', () => req.destroy(new Error('Request timeout')));
			req.end();
		});
	}

	private getCachedResponse(url: string): string | null {
		const cacheFile = this.getCacheFile(url);
		if (!fs.existsSync(cacheFile)) {return null;}

		return ignoreErrorsSync(() => fs.readFileSync(cacheFile, 'utf8')) || null;
	}

	private async storeResponse(url: string, data: string, etag?: string): Promise<void> {
		const cacheFile = this.getCacheFile(url);
		ignoreErrorsSync(() => fs.writeFileSync(cacheFile, data, 'utf8'));
		
		if (etag) {
			const key = `http.etag:${url}`;
			await this.context.globalState.update(key, etag);
		}
	}

	private getStoredEtag(url: string): string | null {
		const key = `http.etag:${url}`;
		return this.context.globalState.get<string>(key) || null;
	}

	private getCacheFile(url: string): string {
		const cacheDir = this.getCacheDirectory();
		const filename = createSafeFilename(url, Constants.CACHE_FILE_PREFIX, '.json');
		return path.join(cacheDir, filename);
	}

	private getCacheDirectory(): string {
		const cacheDir = this.context.globalStorageUri?.fsPath || 
			path.join(this.context.extensionPath, 'media');
		
		ignoreErrorsSync(() => fs.mkdirSync(cacheDir, { recursive: true }));
		return cacheDir;
	}
}