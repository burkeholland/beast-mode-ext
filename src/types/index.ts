import * as vscode from 'vscode';

/**
 * Lightweight shape describing how settings will be rendered in the webview.
 * This is intentionally minimal and self-explanatory.
 */
export interface SettingDefinition {
	key: string;
	type: 'boolean' | 'number' | 'string' | 'json';
	title?: string;
	description?: string;
	group: string;
	min?: number;
	max?: number;
	step?: number;
	options?: Array<{ value: string; label?: string }>;
	requires?: string[];
	missingExtensions?: string[]; // computed at render time
	info?: string;
	default?: any; // optional default value suggested by remote config or inferred
	recommended?: any; // recommended value for this setting
	hasRecommendation?: boolean; // computed: whether a recommendation exists
	matchesRecommendation?: boolean; // computed: whether current value matches recommendation
	isNew?: boolean; // computed: whether this setting is new/unseen
	seenTimestamp?: string; // computed: when user first saw this setting
}

/**
 * Summary of recommendation status across all settings
 */
export interface RecommendationSummary {
	total: number;
	matching: number;
	differing: number;
}

/**
 * State for tracking new settings
 */
export interface NewSettingsState {
	seenSettings: Record<string, string>; // settingKey -> timestamp
	lastConfigHash?: string; // hash of last processed config to detect changes
	firstRun: boolean; // whether this is the first time running
}

/**
 * State object sent to the webview containing settings data
 */
export interface SettingsState {
	settings: Record<string, any>;
	definitions: SettingDefinition[];
	groups: string[];
	remotePending?: boolean;
	remoteLastChecked?: string;
	recommendationSummary?: RecommendationSummary;
	newSettingsCount?: number; // count of unseen settings
	hasNewSettings?: boolean; // whether any settings are new
	newSettingsByGroup?: Record<string, number>; // count of new settings per group
}

/**
 * Result of configuration loading operation
 */
export interface ConfigurationLoadResult {
	definitions: SettingDefinition[];
	source: 'remote' | 'local';
	timestamp: string;
}

/**
 * Options for HTTP requests
 */
export interface HttpRequestOptions {
	url: string;
	headers?: Record<string, string>;
	timeout?: number;
	useCache?: boolean;
}

/**
 * HTTP response data
 */
export interface HttpResponse {
	data: string;
	headers: Record<string, string>;
	status: number;
	fromCache: boolean;
	etag?: string;
}

/**
 * Result of schema lookup for a configuration key
 */
export interface SchemaLookupResult {
	schema: any;
	extensionId?: string;
}

/**
 * Configuration service interface
 */
export interface IConfigurationService {
	loadConfiguration(): Promise<ConfigurationLoadResult>;
	startPolling(): void;
	stopPolling(): void;
	checkForRemoteUpdates(): Promise<boolean>;
	refreshConfiguration(): Promise<void>;
	onConfigurationChanged: vscode.Event<ConfigurationLoadResult>;
}

/**
 * HTTP service interface
 */
export interface IHttpService {
	get(options: HttpRequestOptions): Promise<HttpResponse>;
	fetchGistContent(gistId: string): Promise<string | null>;
	resolveToRawUrl(url: string): Promise<string | null>;
}

/**
 * Schema inference service interface
 */
export interface ISchemaInferenceService {
	enrichSettingDefinition(key: string, config: any): SettingDefinition;
	findSchemaForKey(key: string): SchemaLookupResult | undefined;
	deriveGroupFromKey(key: string): string;
	applyDefaultsToUserSettings(definitions: SettingDefinition[]): Promise<void>;
	normalizeRequires(input: any): string[];
	mergeRequires(a: string[], b: string[]): string[];
}

/**
 * State manager interface
 */
export interface IStateManager {
	collectCurrentSettings(definitions: SettingDefinition[]): Record<string, any>;
	buildWebviewState(definitions: SettingDefinition[]): SettingsState;
	updateSetting(key: string, value: any): Promise<void>;
	installExtensions(extensionIds: string[]): Promise<void>;
}

/**
 * New settings tracker interface
 */
export interface INewSettingsTracker {
	initialize(definitions: SettingDefinition[]): Promise<void>;
	detectNewSettings(definitions: SettingDefinition[]): SettingDefinition[];
	markAsSeen(settingKeys: string[]): Promise<void>;
	markAllAsSeen(definitions: SettingDefinition[]): Promise<void>;
	isSettingNew(settingKey: string): boolean;
	getNewSettingsCount(definitions: SettingDefinition[]): number;
	clearState(): Promise<void>;
}

/**
 * HTML renderer interface
 */
export interface IHtmlRenderer {
	renderHtml(state: SettingsState): string;
	generateNonce(): string;
	setWebviewView(webviewView: vscode.WebviewView): void;
}