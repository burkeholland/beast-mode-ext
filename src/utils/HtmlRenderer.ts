import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IHtmlRenderer, SettingsState } from '../types';
import { Constants } from '../constants';
import { generateNonce, ignoreErrorsSync } from './common';

/**
 * Service for rendering HTML content for the webview
 */
export class HtmlRenderer implements IHtmlRenderer {
	private templateCache?: string;
	private webviewView?: vscode.WebviewView;

	constructor(private readonly context: vscode.ExtensionContext) {}

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
		return generateNonce();
	}

	/**
	 * Set the webview reference for CSP source
	 */
	setWebviewView(webviewView: vscode.WebviewView): void {
		this.webviewView = webviewView;
	}

	private buildContentSecurityPolicy(nonce: string): string {
		const cspSource = this.webviewView?.webview.cspSource || 'vscode-resource:';
		return [
			`default-src 'none'`,
			`style-src ${cspSource} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}'`
		].join('; ');
	}

	private loadTemplate(): string {
		if (this.templateCache) {
			return this.templateCache;
		}

		const templatePath = path.join(
			this.context.extensionPath, 
			'media', 
			Constants.FILES.WEBVIEW_TEMPLATE
		);

		const fallbackHtml = `
			<html>
				<body>
					<h3>Failed to load settings template.</h3>
					<p>Template file not found at: ${templatePath}</p>
				</body>
			</html>
		`;

		const template = ignoreErrorsSync(() => fs.readFileSync(templatePath, 'utf8'));
		this.templateCache = template || fallbackHtml;
		return this.templateCache;
	}
}