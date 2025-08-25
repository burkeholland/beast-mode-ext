import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { URL } from 'url';
import { IHttpService, HttpRequestOptions, HttpResponse } from '../types';

/**
 * Service for handling HTTP requests with caching and error handling
 */
export class HttpService implements IHttpService {
	private static readonly DEFAULT_TIMEOUT = 9000;
	private static readonly USER_AGENT = 'on-by-default-ext';

	constructor(private readonly context: vscode.ExtensionContext) {}

	/**
	 * Make an HTTP GET request with optional caching
	 */
	async get(options: HttpRequestOptions): Promise<HttpResponse> {
		const { url, headers = {}, timeout = HttpService.DEFAULT_TIMEOUT, useCache = true } = options;

		if (!/^https?:\/\//i.test(url)) {
			throw new Error('Invalid URL: must be HTTP or HTTPS');
		}

		const requestHeaders: Record<string, string> = {
			'User-Agent': HttpService.USER_AGENT,
			'Accept': 'application/json',
			...headers
		};

		// Handle caching with ETag if enabled
		let etagKey: string | undefined;
		let cacheFile: string | undefined;
		
		if (useCache) {
			etagKey = `http.etag:${url}`;
			const cacheDir = this.getCacheDirectory();
			cacheFile = path.join(cacheDir, this.getCacheFileName(url));
			
			const prevEtag = this.context.globalState.get<string>(etagKey);
			if (prevEtag) {
				requestHeaders['If-None-Match'] = prevEtag;
			}
		}

		try {
			const urlObj = new URL(url);
			const response = await this.makeHttpRequest(urlObj, requestHeaders, timeout);

			// Handle 304 Not Modified
			if (response.status === 304 && cacheFile && fs.existsSync(cacheFile)) {
				const cachedData = fs.readFileSync(cacheFile, 'utf8');
				return {
					data: cachedData,
					headers: response.headers,
					status: 200,
					fromCache: true,
					etag: response.headers['etag']
				};
			}

			if (response.status < 200 || response.status >= 300) {
				throw new Error(`HTTP ${response.status}`);
			}

			// Cache successful response
			if (useCache && cacheFile && response.data) {
				await this.cacheResponse(cacheFile, response.data, etagKey!, response.headers['etag']);
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
			if (useCache && cacheFile && fs.existsSync(cacheFile)) {
				const cachedData = fs.readFileSync(cacheFile, 'utf8');
				return {
					data: cachedData,
					headers: {},
					status: 200,
					fromCache: true
				};
			}
			throw error;
		}
	}

	/**
	 * Fetch content from a GitHub Gist
	 */
	async fetchGistContent(gistId: string): Promise<string | null> {
		try {
			const apiUrl = `https://api.github.com/gists/${gistId}`;
			const cacheKey = `gist.etag:${gistId}`;
			const cacheDir = this.getCacheDirectory();
			const cacheFile = path.join(cacheDir, `gist-${gistId}.json`);

			const headers: Record<string, string> = {
				'Accept': 'application/vnd.github.v3+json'
			};

			const prevEtag = this.context.globalState.get<string>(cacheKey);
			if (prevEtag) {
				headers['If-None-Match'] = prevEtag;
			}

			const urlObj = new URL(apiUrl);
			const response = await this.makeHttpRequest(urlObj, headers, HttpService.DEFAULT_TIMEOUT);

			// Handle 304 Not Modified
			if (response.status === 304) {
				if (fs.existsSync(cacheFile)) {
					return fs.readFileSync(cacheFile, 'utf8');
				}
				return null;
			}

			if (response.status < 200 || response.status >= 300) {
				return null;
			}

			const parsed = JSON.parse(response.data);
			const files = parsed?.files || {};
			
			// Look for config.json first, then any .json file
			let targetFile = files['config.json'];
			if (!targetFile) {
				const jsonFiles = Object.keys(files).filter(name => name.endsWith('.json'));
				if (jsonFiles.length > 0) {
					targetFile = files[jsonFiles[0]];
				}
			}

			if (!targetFile || !targetFile.content) {
				return null;
			}

			// Cache the content and etag
			if (response.headers['etag']) {
				await this.context.globalState.update(cacheKey, response.headers['etag']);
				try {
					fs.writeFileSync(cacheFile, targetFile.content, 'utf8');
				} catch {
					// Ignore cache write errors
				}
			}

			return targetFile.content;

		} catch {
			return null;
		}
	}

	/**
	 * Resolve a URL to its raw form, handling GitHub Gist URLs specially
	 */
	async resolveToRawUrl(url: string): Promise<string | null> {
		if (!url) {
			return null;
		}

		// Check for GitHub Gist URLs
		const gistMatch = url.match(/gist.github(?:usercontent)?\.com\/(?:[^\/]+\/)?([0-9a-fA-F]{6,})/i);
		if (gistMatch && gistMatch[1]) {
			return `gist:${gistMatch[1]}`;
		}

		// For regular URLs, keep query parameters but strip hash
		return url.split('#')[0];
	}

	/**
	 * Make the actual HTTP request
	 */
	private makeHttpRequest(
		urlObj: URL, 
		headers: Record<string, string>, 
		timeout: number
	): Promise<{ data: string; headers: Record<string, string>; status: number }> {
		return new Promise((resolve, reject) => {
			const req = https.request({
				hostname: urlObj.hostname,
				path: urlObj.pathname + (urlObj.search || ''),
				method: 'GET',
				headers,
				port: urlObj.port ? Number(urlObj.port) : 443,
				timeout
			}, (res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
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

	/**
	 * Get the cache directory, creating it if necessary
	 */
	private getCacheDirectory(): string {
		const cacheDir = this.context.globalStorageUri?.fsPath || 
			path.join(this.context.extensionPath, 'media');
		
		try {
			fs.mkdirSync(cacheDir, { recursive: true });
		} catch {
			// Ignore errors creating cache directory
		}
		
		return cacheDir;
	}

	/**
	 * Generate a safe cache file name from a URL
	 */
	private getCacheFileName(url: string): string {
		// Create a safe filename from the URL
		const urlHash = Buffer.from(url).toString('base64')
			.replace(/[^a-zA-Z0-9]/g, '')
			.substring(0, 32);
		return `remote-config-${urlHash}.json`;
	}

	/**
	 * Cache response data and etag
	 */
	private async cacheResponse(
		cacheFile: string, 
		data: string, 
		etagKey: string, 
		etag?: string
	): Promise<void> {
		try {
			fs.writeFileSync(cacheFile, data, 'utf8');
			if (etag) {
				await this.context.globalState.update(etagKey, etag);
			}
		} catch {
			// Ignore cache write errors
		}
	}
}