import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseJsonc } from 'jsonc-parser';

interface SettingDefinition {
    key: string;
    type: 'boolean' | 'number' | 'string' | 'json';
    title?: string;
    description: string;
    group: string;
    min?: number;
    max?: number;
    step?: number;
    // For string enums, provide available options
    options?: Array<{ value: string; label?: string }>;
    // Optional: extension ids required for this setting to work
    requires?: string[];
    // Computed at render time: which required extensions are currently missing
    missingExtensions?: string[];
    // Optional: extra info shown on hover in the UI
    info?: string;
}

interface KeybindingEntry {
    command: string;
    title: string;
    default?: string;
    when?: string;
    current?: string;
    overridden?: boolean;
}

interface KeybindingToggle {
    key: string;
    title: string;
    description: string;
    keybinding: {
        command: string;
        key: string;
        when?: string;
    };
    disables?: Array<{
        command: string;
        key: string;
        when?: string;
    }>;
}

interface SettingsState {
    settings: Record<string, any>;
    definitions: SettingDefinition[];
    groups: string[];
    keybindings: KeybindingEntry[];
    keybindingToggles: Array<KeybindingToggle & { enabled: boolean }>;
}

class BeastModeSettingsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'beastModeSettings';
    private view?: vscode.WebviewView;
    private disposables: vscode.Disposable[] = [];

    constructor(private readonly context: vscode.ExtensionContext) {}

    private settingDefinitions: SettingDefinition[] = [];

    private configKeybindings: { command: string; title?: string; default?: string; when?: string }[] = [];

    private keybindingToggles: KeybindingToggle[] = [];

    private ensureLoadedFromConfig() {
        try {
            const cfgPath = path.join(this.context.extensionPath, 'media', 'config.json');
            if (fs.existsSync(cfgPath)) {
                const raw = fs.readFileSync(cfgPath, 'utf8');
                const json = JSON.parse(raw);
                if (Array.isArray(json?.settings)) {
                    // json.settings can be either:
                    // 1) flat entries: { key, title?, description?, group?, type?, options?, min?, max?, step? }
                    // 2) grouped entries: { group: string, settings: [ ...flat entries... ] }
                    const defs: SettingDefinition[] = [];
                    for (const entry of json.settings) {
                        // Group container
                        if (entry && typeof entry.group === 'string' && Array.isArray(entry.settings)) {
                            const groupName = entry.group as string;
                            const groupRequires: string[] = this.normalizeRequires(entry.requiresExtension || entry.requiresExtensions || entry.requires);
                            for (const s of entry.settings) {
                                if (!s?.key || typeof s.key !== 'string') { continue; }
                                const enriched = this.inferDefinitionFromSchema(
                                    s.key,
                                    s.title,
                                    s.description,
                                    // Prefer explicit per-setting group if provided, else container group
                                    s.group || groupName,
                                    s.type,
                                    s.options,
                                    s.min,
                                    s.max,
                                    s.step,
                                    this.mergeRequires(groupRequires, this.normalizeRequires(s.requiresExtension || s.requiresExtensions || s.requires))
                                );
                                // Attach optional info if provided
                                if (typeof s.info === 'string') {
                                    (enriched as any).info = s.info;
                                }
                                defs.push(enriched);
                            }
                            continue;
                        }
                        // Flat entry
                        if (entry?.key && typeof entry.key === 'string') {
                            const enriched = this.inferDefinitionFromSchema(
                                entry.key,
                                entry.title,
                                entry.description,
                                entry.group,
                                entry.type,
                                entry.options,
                                entry.min,
                                entry.max,
                                entry.step,
                                this.normalizeRequires(entry.requiresExtension || entry.requiresExtensions || entry.requires)
                            );
                            if (typeof (entry as any).info === 'string') {
                                (enriched as any).info = (entry as any).info;
                            }
                            defs.push(enriched);
                        }
                    }
                    if (defs.length) {
                        this.settingDefinitions = defs;
                    }
                }
                if (Array.isArray(json?.keybindings)) {
                    this.configKeybindings = json.keybindings as any[];
                }
                // Prefer explicit keybindingToggles if provided; else derive from keybindings list
                if (Array.isArray(json?.keybindingToggles) && json.keybindingToggles.length) {
                    this.keybindingToggles = (json.keybindingToggles as any[]).map(t => this.normalizeKeybindingToggle(t)).filter(Boolean) as KeybindingToggle[];
                } else if (Array.isArray(json?.keybindings) && json.keybindings.length) {
                    this.keybindingToggles = this.deriveKeybindingToggles(json.keybindings as any[]);
                }
            }
        } catch {
            // ignore and keep defaults
        }
    }

    private normalizeKeybindingToggle(input: any): KeybindingToggle | undefined {
        if (!input || typeof input !== 'object') { return undefined; }
        const key = String(input.key || input.id || input.keyId || input.keybinding?.command || input.command || '');
        const title = String(input.title || input.name || input.keybinding?.title || input.command || key || 'Keybinding');
        const description = String(input.description || input.keybinding?.command || input.command || title);
        const kb = input.keybinding || { command: input.command, key: input.key || input.default, when: input.when };
        if (!kb || !kb.command || !kb.key) { return undefined; }
        const togg: KeybindingToggle = {
            key,
            title,
            description,
            keybinding: { command: String(kb.command), key: String(kb.key), when: kb.when ? String(kb.when) : undefined },
            disables: Array.isArray(input.disables) ? input.disables.map((d: any) => ({ command: String(d.command), key: String(d.key), when: d.when ? String(d.when) : undefined })) : undefined
        };
        return togg;
    }

    private deriveKeybindingToggles(items: Array<{ command: string; title?: string; default?: string; when?: string }>): KeybindingToggle[] {
        const out: KeybindingToggle[] = [];
        for (const it of items) {
            if (!it?.command || !it?.default) { continue; }
            out.push({
                key: it.command,
                title: it.title || it.command,
                description: it.command,
                keybinding: { command: it.command, key: it.default, when: it.when }
            });
        }
        return out;
    }

    private normalizeRequires(input: any): string[] {
        if (!input) { return []; }
        if (typeof input === 'string') { return [input]; }
        if (Array.isArray(input)) { return input.filter((s: any) => typeof s === 'string'); }
        return [];
    }

    private mergeRequires(a: string[], b: string[]): string[] {
        const set = new Set<string>();
    for (const v of a) { set.add(v); }
    for (const v of b) { set.add(v); }
        return Array.from(set);
    }

    private inferDefinitionFromSchema(
        key: string,
        title?: string,
        description?: string,
        groupOverride?: string,
        typeOverride?: SettingDefinition['type'],
        optionsOverride?: Array<{ value: string; label?: string }>,
        minOverride?: number,
        maxOverride?: number,
        stepOverride?: number,
        requiresOverride?: string[]
    ): SettingDefinition {
        const found = this.findConfigSchemaForKey(key);
        const schema = found?.schema;
        const group = groupOverride || this.deriveGroupFromKey(key);
        const label = title || key.split('.').slice(-1)[0];
        let type: SettingDefinition['type'] = 'string';
        let options: Array<{ value: string; label?: string }> | undefined;
        let min: number | undefined;
        let max: number | undefined;
        let step: number | undefined;
        let requires: string[] | undefined;
        if (schema) {
            const sType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
            if (sType === 'boolean') {
                type = 'boolean';
            } else if (sType === 'number' || sType === 'integer') {
                type = 'number';
                step = sType === 'integer' ? 1 : undefined;
            } else if (sType === 'object' || sType === 'array') {
                type = 'json';
            } else {
                type = 'string';
            }
            if (schema.enum && Array.isArray(schema.enum)) {
                options = schema.enum.map((v: any, i: number) => ({ value: String(v), label: Array.isArray(schema.enumDescriptions) ? schema.enumDescriptions[i] : undefined }));
            } else if (schema.oneOf || schema.anyOf) {
                const alts = (schema.oneOf || schema.anyOf) as any[];
                const enums = alts
                    .filter(e => e?.const !== undefined || e?.enum)
                    .map(e => e.const ?? (Array.isArray(e.enum) ? e.enum[0] : undefined))
                    .filter((v: any) => v !== undefined);
                if (enums && enums.length) {
                    options = enums.map((v: any) => ({ value: String(v) }));
                }
            }
            if (typeof schema.minimum === 'number') {
                min = schema.minimum;
            }
            if (typeof schema.maximum === 'number') {
                max = schema.maximum;
            }
            // If we could determine which extension contributes this schema and it's not our own, mark as requirement
            if (found?.extensionId && found.extensionId !== this.context.extension.id) {
                requires = [found.extensionId];
            }
        }
        // Fallback: infer type from current/default value via configuration.inspect()
        if (!schema || !type || type === 'string') {
            try {
                const info = this.getConfiguration().inspect<any>(key);
                const sample = info?.globalValue ?? info?.workspaceValue ?? info?.workspaceFolderValue ?? info?.defaultValue;
                if (sample !== undefined) {
                    const t = typeof sample;
                    if (t === 'boolean') {
                        type = 'boolean';
                    } else if (t === 'number') {
                        type = 'number';
                        if (Number.isInteger(sample) && step === undefined) {
                            step = 1;
                        }
                    } else if (t === 'object' && sample !== null) {
                        type = 'json';
                    } else {
                        type = 'string';
                    }
                }
            } catch { /* ignore */ }
        }

        // Apply explicit overrides from config.json (highest precedence)
        if (typeOverride) {
            type = typeOverride;
        }
        if (optionsOverride && optionsOverride.length) {
            options = optionsOverride.map(o => ({ value: String(o.value), label: o.label }));
        }
        if (minOverride !== undefined) { min = minOverride; }
        if (maxOverride !== undefined) { max = maxOverride; }
        if (stepOverride !== undefined) { step = stepOverride; }
        if (requiresOverride && requiresOverride.length) {
            requires = this.normalizeRequires(requiresOverride);
        }
        // No internal fallbacks: enums/options should come from config.json or schema only
        return {
            key,
            type,
            title: label,
            description: description || label,
            group,
            min, max, step,
            options,
            requires
        };
    }

    private findConfigSchemaForKey(key: string): { schema: any; extensionId?: string } | undefined {
        for (const ext of vscode.extensions.all) {
            const contrib = (ext.packageJSON?.contributes as any) || {};
            const config = contrib.configuration;
            if (!config) {
                continue;
            }
            const buckets = Array.isArray(config) ? config : [config];
            for (const bucket of buckets) {
                const props = bucket?.properties;
                if (props && Object.prototype.hasOwnProperty.call(props, key)) {
                    return { schema: props[key], extensionId: ext.id };
                }
            }
        }
        return undefined;
    }

    private deriveGroupFromKey(key: string): string {
        const first = key.split('.')[0];
    if (first === 'github') { return 'GitHub Copilot'; }
    if (first === 'githubPullRequests') { return 'GitHub PRs'; }
    if (first === 'terminal') { return 'Terminal'; }
    if (first === 'workbench') { return 'Workbench'; }
    if (first === 'editor') { return 'Editor'; }
    if (first === 'chat') { return 'Chat'; }
    if (first === 'git') { return 'Git'; }
    if (first === 'window') { return 'Window'; }
        return first.charAt(0).toUpperCase() + first.slice(1);
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))]
        };
        webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
    this.ensureLoadedFromConfig();
        // Re-render when the view becomes visible again (keeps in sync with outside changes)
        this.disposables.push(
            webviewView.onDidChangeVisibility(() => {
                if (webviewView.visible) {
                    this.postState();
                }
            })
        );
        this.postState();
    }

    /** Expose a safe refresh to re-render the webview */
    public refresh() {
        this.postState();
    }

    private handleMessage(message: any) {
        switch (message.type) {
            case 'ready':
                this.postState();
                break;
            case 'updateSetting':
                this.updateSetting(message.key, message.value);
                break;
            case 'toggleKeybinding':
                this.toggleKeybinding(message.key, message.enabled);
                break;
            case 'installExtensions':
                this.installExtensions(Array.isArray(message.ids) ? message.ids : []);
                break;
        }
    }

    private getConfiguration() {
        return vscode.workspace.getConfiguration();
    }

    private postState() {
            if (!this.view) {
                return;
            }
        // Compute dependency availability per definition
        const defsWithAvailability: SettingDefinition[] = this.settingDefinitions.map(d => {
            const requires = Array.isArray(d.requires) ? d.requires : [];
            const missing = requires.filter(id => !vscode.extensions.getExtension(id));
            return { ...d, missingExtensions: missing };
        });
    const state: SettingsState = {
            settings: this.collectCurrentSettings(),
            definitions: defsWithAvailability,
            groups: Array.from(new Set(defsWithAvailability.map(d => d.group))),
            keybindings: this.collectKeybindings(),
            keybindingToggles: this.collectKeybindingToggles()
        };
    this.view.webview.html = this.getHtml(state);
    }

    private collectCurrentSettings(): Record<string, any> {
        const config = this.getConfiguration();
        const out: Record<string, any> = {};
        for (const def of this.settingDefinitions) {
            out[def.key] = config.get(def.key);
        }
        return out;
    }

    private collectKeybindings(): KeybindingEntry[] {
        // For now, return empty array since we're replacing with toggles
        return [];
    }

    private collectKeybindingToggles(): Array<KeybindingToggle & { enabled: boolean }> {
        return this.keybindingToggles.map(toggle => ({
            ...toggle,
            enabled: this.isKeybindingToggleEnabled(toggle)
        }));
    }

    private isKeybindingToggleEnabled(toggle: KeybindingToggle): boolean {
        const arr = this.readUserKeybindingsArray();
        if (!arr) { return false; }
        const hasMainBinding = arr.some((entry: any) =>
            entry?.command === toggle.keybinding.command &&
            entry?.key === toggle.keybinding.key
        );
        if (!hasMainBinding) { return false; }
        if (toggle.disables && toggle.disables.length) {
            const hasAllDisables = toggle.disables.every(disable =>
                arr.some((entry: any) => entry?.command === `-${disable.command}` && entry?.key === disable.key)
            );
            return hasAllDisables;
        }
        return true;
    }

    private async toggleKeybinding(toggleKey: string, enabled: boolean) {
        const toggle = this.keybindingToggles.find(t => t.key === toggleKey);
        if (!toggle) {
            vscode.window.showErrorMessage(`Unknown keybinding toggle: ${toggleKey}`);
            return;
        }
        const ok = await this.openAndMutateKeybindingsFile((arr) => {
            let out = Array.isArray(arr) ? arr.slice() : [];
            const disableCommands = new Set<string>((toggle.disables || []).map(d => `-${d.command}`));
            if (enabled) {
                // Remove ALL existing entries for this command (any key/when/args)
                out = out.filter(e => e?.command !== toggle.keybinding.command);
                // Also remove ALL existing unbindings for listed disables (any key)
                if (disableCommands.size) {
                    out = out.filter(e => !(typeof e?.command === 'string' && disableCommands.has(e.command)));
                }
                // Add the main keybinding
                const newBinding: any = { key: toggle.keybinding.key, command: toggle.keybinding.command };
                if (toggle.keybinding.when) { newBinding.when = toggle.keybinding.when; }
                out.push(newBinding);
                // Add unbindings for disables
                if (toggle.disables) {
                    for (const d of toggle.disables) {
                        out.push({ key: d.key, command: `-${d.command}` });
                    }
                }
            } else {
                // Remove ALL entries for this command and ALL unbindings for listed disables
                out = out.filter(e => {
                    if (e?.command === toggle.keybinding.command) { return false; }
                    if (typeof e?.command === 'string' && disableCommands.has(e.command)) { return false; }
                    return true;
                });
            }
            return out;
        });
        if (!ok) {
            vscode.window.showErrorMessage('Unable to update keybindings. Opening Keyboard Shortcuts (JSON)…');
            await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
        }
        this.postState();
    }

    // Legacy path (unused in package.json mode) - kept for reference or future fallback
    private readUserKeybindingsArray(): any[] | undefined {
        // Prefer the exact user keybindings.json for the current profile, not the default/read-only doc
        const profileKb = this.getUserKeybindingsPath();
        if (profileKb) {
            const matchOpenDoc = vscode.workspace.textDocuments.find(d => {
                try {
                    // Compare fsPath exactly (case-insensitive on Windows)
                    const a = (d.uri.fsPath || d.fileName);
                    if (!a) { return false; }
                    return process.platform === 'win32'
                        ? a.toLowerCase() === profileKb.toLowerCase()
                        : a === profileKb;
                } catch { return false; }
            });
            if (matchOpenDoc) {
                try {
                    const parsed = parseJsonc(matchOpenDoc.getText());
                    if (Array.isArray(parsed)) { return parsed; }
                } catch { /* ignore */ }
            }
            // Fallback to file-system read
            if (fs.existsSync(profileKb)) {
                try {
                    const raw = fs.readFileSync(profileKb, 'utf8');
                    const arr = parseJsonc(raw);
                    if (Array.isArray(arr)) { return arr; }
                } catch { /* ignore */ }
            }
        }
        return undefined;
    }

    // removed package.json mutation helpers (not reliable for runtime toggling)

    private async openAndMutateKeybindingsFile(mutator: (arr: any[]) => any[]): Promise<boolean> {
        try {
            await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
        } catch { /* ignore */ }

        // Wait briefly for the editor to open
        let kbDoc: vscode.TextDocument | undefined;
        const profileKb = this.getUserKeybindingsPath();
        for (let i = 0; i < 15; i++) {
            const active = vscode.window.activeTextEditor?.document;
            if (active && this.isUserKeybindingsDocument(active)) {
                kbDoc = active;
                break;
            }
            const found = vscode.workspace.textDocuments.find(d => this.isUserKeybindingsDocument(d));
            if (found) { kbDoc = found; break; }
            await new Promise(res => setTimeout(res, 100));
        }
        // Fallback: explicitly open the file-based user keybindings
        if (!kbDoc && profileKb) {
            try {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(profileKb));
                await vscode.window.showTextDocument(doc, { preview: false });
                kbDoc = doc;
            } catch { /* ignore */ }
        }
        if (!kbDoc) { return false; }

        let curArr: any[] = [];
        try {
            const parsed = parseJsonc(kbDoc.getText());
            if (Array.isArray(parsed)) { curArr = parsed; }
        } catch { /* ignore */ }

        const newArr = mutator(curArr);
        const newText = JSON.stringify(newArr, null, 2);
        if (kbDoc.getText() === newText) { return true; }

        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(0, 0, kbDoc.lineCount, kbDoc.lineAt(Math.max(0, kbDoc.lineCount - 1)).text.length);
        edit.replace(kbDoc.uri, fullRange, newText);
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) { return false; }
        try { await kbDoc.save(); } catch { /* ignore */ }
        return true;
    }

    /** Detect if a TextDocument corresponds to the current profile's user keybindings.json */
    private isUserKeybindingsDocument(doc: vscode.TextDocument): boolean {
        try {
            const profileKb = this.getUserKeybindingsPath();
            const fsPath = doc.uri.fsPath || doc.fileName || '';
            if (profileKb) {
                const a = process.platform === 'win32' ? (fsPath.toLowerCase()) : fsPath;
                const b = process.platform === 'win32' ? (profileKb.toLowerCase()) : profileKb;
                if (a === b) { return true; }
            }
            // Accept vscode-userdata URI that represents the user keybindings.json
            if (doc.uri.scheme === 'vscode-userdata') {
                const p = (doc.uri.path || '').toLowerCase();
                // Typical path: /User/keybindings.json or /User/profiles/<id>/keybindings.json
                if (/\/user\//.test(p) && p.endsWith('keybindings.json')) {
                    return true;
                }
            }
        } catch { /* ignore */ }
        return false;
    }

    private getUserSettingsRootDir(): string | undefined {
        // Prefer VS Code's current profile settings directory if available
        const appSettingsPath = (vscode.env as any)?.appSettingsPath as string | undefined;
        
        if (appSettingsPath && typeof appSettingsPath === 'string' && appSettingsPath.length > 0) {
            return appSettingsPath; // e.g., ~/.config/Code - Insiders/User/profiles/<id>
        }
        // Fallback: derive config directory name based on app variant
        const display = (vscode.env as any)?.appName || '';
        let appName = 'Code';
        const lower = display.toLowerCase();
        if (lower.includes('insiders')) {
            appName = 'Code - Insiders';
        } else if (lower.includes('oss')) {
            appName = 'Code - OSS';
        } else if (lower.includes('codium')) {
            appName = 'VSCodium';
        } else {
            appName = 'Code';
        }
        const home = process.env.HOME || process.env.USERPROFILE;
        if (!home) {
            return undefined;
        }
        const fallbackPath = process.platform === 'win32' 
            ? path.join(home, 'AppData', 'Roaming', appName, 'User')
            : process.platform === 'darwin' 
            ? path.join(home, 'Library', 'Application Support', appName, 'User')
            : path.join(home, '.config', appName, 'User');
        return fallbackPath;
    }

    private getUserKeybindingsPath(): string | undefined {
        const root = this.getUserSettingsRootDir();
        return root ? path.join(root, 'keybindings.json') : undefined;
    }

    /** Begin watching external sources that can affect our state (config, keybindings, config.json) */
    public startExternalWatchers() {
        // 1) Configuration changes: only refresh if relevant settings changed
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                // If any tracked setting key is affected, refresh
                const affected = this.settingDefinitions.some(def => e.affectsConfiguration(def.key));
                if (affected) {
                    this.postState();
                }
            })
        );

        // 1b) Extensions installed/removed/changed
        this.disposables.push(
            vscode.extensions.onDidChange(() => this.postState())
        );

        // 2) User keybindings.json changes - watch for changes to update toggle states
        const profileKb = this.getUserKeybindingsPath();
        if (profileKb) {
            const kbDir = path.dirname(profileKb);
            // Watch the file if it exists
            if (fs.existsSync(profileKb)) {
                try {
                    const watcher = fs.watch(profileKb, { persistent: false }, () => {
                        setTimeout(() => this.postState(), 50);
                    });
                    this.disposables.push(new vscode.Disposable(() => watcher.close()));
                } catch {
                    fs.watchFile(profileKb, { interval: 1000 }, () => this.postState());
                    this.disposables.push(new vscode.Disposable(() => fs.unwatchFile(profileKb)));
                }
            }
            // Also watch the parent directory for create/rename of keybindings.json
            if (fs.existsSync(kbDir)) {
                try {
                    const dirWatcher = fs.watch(kbDir, { persistent: false }, (eventType, filename) => {
                        if (typeof filename === 'string' && filename.toLowerCase() === 'keybindings.json') {
                            setTimeout(() => this.postState(), 50);
                        }
                    });
                    this.disposables.push(new vscode.Disposable(() => dirWatcher.close()));
                } catch { /* ignore */ }
            }
        }

        // 3) Our own media/config.json (setting definitions / kb list) changes
        const cfgPath = path.join(this.context.extensionPath, 'media', 'config.json');
        if (fs.existsSync(cfgPath)) {
            try {
                const watcher = fs.watch(cfgPath, { persistent: false }, () => {
                    // Reload definitions and re-render
                    this.ensureLoadedFromConfig();
                    this.postState();
                });
                this.disposables.push(new vscode.Disposable(() => watcher.close()));
            } catch {
                fs.watchFile(cfgPath, { interval: 1000 }, () => {
                    this.ensureLoadedFromConfig();
                    this.postState();
                });
                this.disposables.push(new vscode.Disposable(() => fs.unwatchFile(cfgPath)));
            }
        }
    }

    public dispose() {
        for (const d of this.disposables.splice(0)) {
            try { d.dispose(); } catch { /* ignore */ }
        }
    }

    private async updateSetting(key: string, value: any) {
        await this.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
        this.postState();
    }

    private async installExtensions(ids: string[]) {
        if (!ids || !ids.length) { return; }
        for (const id of ids) {
            try {
                await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
            } catch (e) {
                // Fallback: open extensions view with @id query
                await vscode.commands.executeCommand('workbench.extensions.search', `@id:${id}`);
                vscode.window.showWarningMessage(`Failed to install ${id} automatically. Opened Extensions view instead.`);
            }
        }
        // After install attempt, refresh UI
        this.postState();
    }

    private getHtml(state: SettingsState): string {
        const nonce = this.getNonce();
        const csp = [
            `default-src 'none'`,
            `style-src ${this.getWebviewCspSource()} 'unsafe-inline'`,
            `script-src 'nonce-${nonce}'`
        ].join('; ');
        const templatePath = path.join(this.context.extensionPath, 'media', 'settingsWebview.html');
        let html: string;
        try {
            html = fs.readFileSync(templatePath, 'utf8');
        } catch (e) {
            return `<html><body><h3>Failed to load settings template.</h3><pre>${(e as any)?.message || e}</pre></body></html>`;
        }
        return html
            .replace(/%%CSP%%/g, csp)
            .replace(/%%NONCE%%/g, nonce)
            .replace(/%%STATE_JSON%%/g, () => JSON.stringify(state));
    }

    private getWebviewCspSource() {
        return this.view?.webview.cspSource || 'vscode-resource:';
    }

    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}

export function activate(context: vscode.ExtensionContext) {
    const provider = new BeastModeSettingsWebviewProvider(context);
    // Ensure provider disposes resources on deactivate
    context.subscriptions.push(provider);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(BeastModeSettingsWebviewProvider.viewType, provider)
    );

    // Keep webview synchronized with external changes
    provider.startExternalWatchers();

    context.subscriptions.push(
        vscode.commands.registerCommand('beast-mode.refreshSettings', () => provider['postState']?.())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('beast-mode.toggleAutoApprove', async () => {
            const config = vscode.workspace.getConfiguration();
            const cur = config.get<boolean>('chat.tools.autoApprove');
            await config.update('chat.tools.autoApprove', !cur, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Auto Approve is now ${!cur ? 'Enabled' : 'Disabled'}`);
            provider['postState']?.();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('beast-mode.setMaxRequests', async () => {
            const config = vscode.workspace.getConfiguration();
            const cur = config.get<number>('chat.agent.maxRequests') || 1;
            const val = await vscode.window.showInputBox({
                title: 'Set Max Agent Requests',
                value: String(cur),
                validateInput: v => /^(\d+)$/.test(v) ? undefined : 'Enter a positive integer'
            });
            if (val) {
                await config.update('chat.agent.maxRequests', parseInt(val, 10), vscode.ConfigurationTarget.Global);
                provider['postState']?.();
            }
        })
    );
}

export function deactivate() {}
