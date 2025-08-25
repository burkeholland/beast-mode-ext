# Technical Specification: New Settings Notification System

## Overview
This technical specification details the implementation of a notification system for new settings in the On By Default VS Code extension. The system will track which settings users have seen and provide visual indicators for newly discovered settings from remote configurations.

## Architecture / System Design

### High-Level Architecture
The new settings notification system will integrate with the existing architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Extension Host                                │
│  ┌─────────────────────┐     ┌─────────────────────────────────┐ │
│  │ ConfigurationService │────▶│ NewSettingsTracker (NEW)       │ │
│  │ (existing)          │     │ - Track seen settings           │ │
│  │ - Load config       │     │ - Detect new settings          │ │
│  │ - Poll remote       │     │ - Persist state                │ │
│  └─────────────────────┘     └─────────────────────────────────┘ │
│                                      │                          │
│  ┌─────────────────────┐            │                          │
│  │    StateManager     │◀───────────┘                          │
│  │    (existing)       │                                       │
│  │ - Build webview     │                                       │
│  │ - Enhanced with     │                                       │
│  │   new settings data │                                       │
│  └─────────────────────┘                                       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                 Webview UI                                  │ │
│  │ ┌─────────────────────┐  ┌─────────────────────────────────┐ │ │
│  │ │ Setting Items       │  │ New Settings Summary (NEW)     │ │ │
│  │ │ (enhanced)          │  │ - Count of new settings        │ │ │
│  │ │ - "NEW" badges      │  │ - Mark all as seen action      │ │ │
│  │ │ - Individual mark   │  │                                │ │ │
│  │ │   as seen actions   │  │                                │ │ │
│  │ └─────────────────────┘  └─────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Component Integration
1. **NewSettingsTracker**: New service to track seen settings and detect new ones
2. **StateManager**: Enhanced to include new settings information in webview state
3. **ConfigurationService**: Enhanced to trigger new settings detection on config changes
4. **Webview UI**: Enhanced with new setting indicators and management actions

## Data Models

### Enhanced SettingDefinition
```typescript
export interface SettingDefinition {
  // ... existing properties
  isNew?: boolean; // computed: whether this setting is new/unseen
  seenTimestamp?: string; // computed: when user first saw this setting
}
```

### NewSettingsState
```typescript
export interface NewSettingsState {
  seenSettings: Record<string, string>; // settingKey -> timestamp
  lastConfigHash?: string; // hash of last processed config to detect changes
  firstRun: boolean; // whether this is the first time running
}
```

### Enhanced SettingsState
```typescript
export interface SettingsState {
  // ... existing properties
  newSettingsCount?: number; // count of unseen settings
  hasNewSettings?: boolean; // whether any settings are new
  newSettingsByGroup?: Record<string, number>; // count of new settings per group
}
```

## API Design

### NewSettingsTracker Service
```typescript
export interface INewSettingsTracker {
  /**
   * Initialize the tracker with current configuration
   */
  initialize(definitions: SettingDefinition[]): Promise<void>;

  /**
   * Detect new settings by comparing with previously seen settings
   */
  detectNewSettings(definitions: SettingDefinition[]): SettingDefinition[];

  /**
   * Mark specific settings as seen
   */
  markAsSeen(settingKeys: string[]): Promise<void>;

  /**
   * Mark all current settings as seen
   */
  markAllAsSeen(definitions: SettingDefinition[]): Promise<void>;

  /**
   * Check if a setting is new/unseen
   */
  isSettingNew(settingKey: string): boolean;

  /**
   * Get count of new settings
   */
  getNewSettingsCount(definitions: SettingDefinition[]): number;

  /**
   * Clear all tracking state (for testing/reset)
   */
  clearState(): Promise<void>;
}
```

### Enhanced Message Types
```typescript
// New message types for webview communication
interface MarkAsSeenMessage {
  type: 'markAsSeen';
  settingKeys: string[];
}

interface MarkAllAsSeenMessage {
  type: 'markAllAsSeen';
}
```

## Logic and Behaviour

### New Settings Detection Algorithm
1. **Configuration Load**: When configuration is loaded (remote or local):
   - Calculate a hash of all setting keys to detect configuration changes
   - Compare against stored hash to determine if config has changed
   - If changed, proceed with new settings detection

2. **New Setting Identification**:
   - Compare current setting keys with previously seen settings
   - Mark settings as "new" if they don't exist in seen settings record
   - Handle first-run scenario by marking all settings as seen initially

3. **State Persistence**:
   - Store seen settings with timestamps in VS Code global state
   - Update state whenever settings are marked as seen
   - Include error handling for state corruption/unavailability

### User Interaction Flows

#### Individual Setting Interaction
1. User views a setting marked as "new"
2. User can click "Mark as Seen" action to acknowledge
3. Setting is removed from new settings list
4. Visual indicator is removed from setting item

#### Bulk Settings Management
1. User sees summary count of new settings in header area
2. User can click "Mark All as Seen" to acknowledge all new settings
3. All new setting indicators are cleared
4. Summary count is reset to zero

#### Automatic Mark as Seen
1. When user modifies a new setting (changes its value)
2. Automatically mark that setting as seen since interaction implies awareness
3. Remove visual indicator for that setting

### State Management
- **Initialization**: On first run, mark all existing settings as seen to avoid overwhelming new users
- **Persistence**: Use VS Code's `globalState` to persist seen settings across sessions
- **Error Handling**: Gracefully handle state corruption by treating all settings as seen
- **Performance**: Lazy-load and cache new settings calculations to avoid repeated computation

## Tech Stack & Dependencies

### New Dependencies
- No new external dependencies required
- Leverages existing VS Code APIs and extension infrastructure

### Key VS Code APIs Used
- `ExtensionContext.globalState` for persistence
- Existing webview messaging system
- Configuration change events

### Integration Points
- **ConfigurationService**: Add hooks for new settings detection
- **StateManager**: Enhance state building to include new settings information
- **WebviewProvider**: Add message handlers for new settings actions
- **UI**: Enhance existing HTML/CSS/JS with new indicators and actions

## Security & Privacy Considerations

### Data Storage
- **Local Only**: All new settings tracking data stored locally in VS Code global state
- **No External Transmission**: No new settings data transmitted to external services
- **User Control**: Users can clear all tracking state if desired

### Privacy
- **No PII**: Only setting keys and timestamps stored, no personal information
- **Transparent**: User can inspect stored state through VS Code developer tools
- **Opt-out**: Users can disable feature by clearing state (future enhancement)

## Performance Considerations

### Computational Efficiency
- **Hash-based Detection**: Use content hashing to quickly detect configuration changes
- **Lazy Evaluation**: Only calculate new settings when configuration actually changes
- **Cached Results**: Cache new settings calculations until next configuration change

### Memory Usage
- **Minimal State**: Store only setting keys and timestamps, not full definitions
- **Cleanup**: Implement periodic cleanup of old seen settings (optional future enhancement)

### Rendering Performance
- **Incremental Updates**: Only re-render when new settings state actually changes
- **Minimal DOM Changes**: Use targeted DOM updates for new setting indicators

## Implementation Details

### File Structure Changes
```
src/
├── extension.ts (enhanced service registration)
├── services/
│   ├── ConfigurationService.ts (enhanced with new settings hooks)
│   └── NewSettingsTracker.ts (NEW)
├── utils/
│   └── StateManager.ts (enhanced with new settings data)
├── types/
│   └── index.ts (enhanced with new interfaces)
└── providers/
    └── OnByDefaultSettingsWebviewProvider.ts (enhanced message handling)

media/
└── settingsWebview.html (enhanced UI with new indicators)
```

### Database Schema (Global State)
```typescript
// Stored in VS Code globalState under key: 'newSettings.state'
interface StoredNewSettingsState {
  seenSettings: Record<string, string>; // settingKey -> ISO timestamp
  lastConfigHash: string; // SHA-256 hash of setting keys
  version: number; // schema version for future migrations
  lastUpdated: string; // ISO timestamp of last update
}
```

### Error Handling Strategy
1. **State Corruption**: If stored state is invalid, treat all settings as seen
2. **Hash Calculation Failure**: Fall back to key-by-key comparison
3. **Storage Failure**: Continue operation without persistence, log warning
4. **Configuration Load Failure**: Don't update new settings state

## Risks & Mitigations

### Technical Risks

**Risk 1: State Storage Corruption**
- **Impact**: Users lose track of seen settings
- **Probability**: Low
- **Mitigation**: Implement state validation and graceful fallbacks

**Risk 2: Performance Impact**
- **Impact**: Slower extension load/configuration changes
- **Probability**: Medium
- **Mitigation**: Optimize algorithms, implement caching, benchmark performance

**Risk 3: UI Clutter**
- **Impact**: Poor user experience with too many indicators
- **Probability**: Medium
- **Mitigation**: Design clean indicators, provide bulk actions, user testing

### User Experience Risks

**Risk 1: Notification Fatigue**
- **Impact**: Users ignore or disable notifications
- **Probability**: Medium
- **Mitigation**: Minimal, non-intrusive design; user control over notifications

**Risk 2: Confusion About "New" Definition**
- **Impact**: User uncertainty about why settings are marked as new
- **Probability**: Low
- **Mitigation**: Clear documentation, intuitive UX, tooltips/help text

### Business Risks

**Risk 1: Increased Support Burden**
- **Impact**: More user questions about the new feature
- **Probability**: Low
- **Mitigation**: Comprehensive documentation, intuitive design

## Testing Strategy

### Unit Tests
- NewSettingsTracker service methods
- State persistence and retrieval
- New settings detection algorithms
- Hash calculation and comparison

### Integration Tests
- Configuration service integration
- State manager enhancement
- Webview message handling
- End-to-end new settings workflow

### Manual Testing Scenarios
1. First-time user experience (no settings marked as new)
2. Remote configuration update with new settings
3. Individual "mark as seen" actions
4. Bulk "mark all as seen" actions
5. State persistence across extension reloads
6. Error handling for state corruption

### Performance Testing
- Extension load time with new settings tracking
- Configuration change handling performance
- Webview rendering with new setting indicators
- Memory usage over extended sessions

## Migration and Deployment

### Rollout Strategy
1. **Phase 1**: Deploy with feature flag (if available) for gradual rollout
2. **Phase 2**: Enable for all users after initial feedback
3. **Phase 3**: Gather analytics and user feedback for improvements

### Backward Compatibility
- All existing functionality preserved
- New settings tracking gracefully degrades if state unavailable
- No breaking changes to existing APIs or data structures

### Data Migration
- No migration needed for existing users (fresh start with new feature)
- Future schema changes will include migration logic in NewSettingsTracker