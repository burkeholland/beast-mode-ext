/**
 * Application constants
 */
export const Constants = {
	// Timeouts
	HTTP_TIMEOUT_MS: 9000,
	POLLING_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes

	// Storage keys
	GLOBAL_KEYS: {
		REMOTE_PENDING: 'remoteConfig.hasPendingChanges',
		REMOTE_LAST_RAW: 'remoteConfig.lastRawText',
		REMOTE_LAST_CHECKED: 'remoteConfig.lastChecked',
		NEW_SETTINGS_STATE: 'newSettings.state'
	},

	// File names
	FILES: {
		CONFIG: 'config.json',
		WEBVIEW_TEMPLATE: 'settingsWebview.html'
	},

	// HTTP
	USER_AGENT: 'on-by-default-ext',
	CACHE_FILE_PREFIX: 'remote-config-',

	// View
	WEBVIEW_VIEW_TYPE: 'onByDefaultSettings',

	// Commands
	COMMANDS: {
		REFRESH_SETTINGS: 'on-by-default.refreshSettings'
	}
} as const;