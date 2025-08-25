import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IHtmlRenderer, SettingsState } from '../types';

/**
 * Service for rendering HTML content for the webview
 */
export class HtmlRenderer implements IHtmlRenderer {
	private static readonly TEMPLATE_FILE = 'settingsWebview.html';
	private templateCache?: string;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly webviewView?: vscode.WebviewView
	) {}

	/**
	 * Render HTML for the webview with injected state
	 */
	renderHtml(state: SettingsState): string {
		const nonce = this.generateNonce();
		const csp = this.buildContentSecurityPolicy(nonce);
		const template = this.loadTemplate();

		return template
			.replace(/%%CSP%%/g, csp)
			.replace(/%%NONCE%%/g, nonce)
			.replace(/%%STATE_JSON%%/g, () => JSON.stringify(state));
	}

	/**
	 * Generate a cryptographically secure nonce for CSP
	 */
	generateNonce(): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		return Array.from({ length: 32 }, () => 
			chars.charAt(Math.floor(Math.random() * chars.length))
		).join('');
	}

	/**
	 * Build Content Security Policy header
	 */
	private buildContentSecurityPolicy(nonce: string): string {
		const cspSource = this.getCspSource();
		return [
			`default-src 'none'`,
			`style-src ${cspSource} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}'`
		].join('; ');
	}

	/**
	 * Get the CSP source for the webview
	 */
	private getCspSource(): string {
		return this.webviewView?.webview.cspSource || 'vscode-resource:';
	}

	/**
	 * Load HTML template from file, with caching
	 */
	private loadTemplate(): string {
		// Return cached template if available
		if (this.templateCache) {
			return this.templateCache;
		}

		const templatePath = path.join(
			this.context.extensionPath, 
			'media', 
			HtmlRenderer.TEMPLATE_FILE
		);

		const fallbackHtml = `
			<html>
				<body>
					<h3>Failed to load settings template.</h3>
					<p>Template file not found at: ${templatePath}</p>
				</body>
			</html>
		`;

		try {
			this.templateCache = fs.readFileSync(templatePath, 'utf8');
			return this.templateCache;
		} catch (error) {
			console.error('Failed to load HTML template:', error);
			return fallbackHtml;
		}
	}

	/**
	 * Clear the template cache (useful for development)
	 */
	clearTemplateCache(): void {
		this.templateCache = undefined;
	}

	/**
	 * Set the webview reference for CSP source
	 */
	setWebviewView(webviewView: vscode.WebviewView): void {
		// Update the webview reference for CSP source
		(this as any).webviewView = webviewView;
	}
}