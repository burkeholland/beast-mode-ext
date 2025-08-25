# Implementation Plan: New Settings Notification System

## Overview
This plan provides a comprehensive checklist for implementing the new settings notification system. Each step is designed to be clear, actionable, and testable.

## Phase 1: Core Service Implementation

### Step 1: Create NewSettingsTracker Service
- [ ] Create `src/services/NewSettingsTracker.ts` file
- [ ] Implement `INewSettingsTracker` interface with the following methods:
  - [ ] `initialize(definitions: SettingDefinition[]): Promise<void>`
  - [ ] `detectNewSettings(definitions: SettingDefinition[]): SettingDefinition[]`
  - [ ] `markAsSeen(settingKeys: string[]): Promise<void>`
  - [ ] `markAllAsSeen(definitions: SettingDefinition[]): Promise<void>`
  - [ ] `isSettingNew(settingKey: string): boolean`
  - [ ] `getNewSettingsCount(definitions: SettingDefinition[]): number`
  - [ ] `clearState(): Promise<void>`
- [ ] Implement state persistence using VS Code's `globalState`
- [ ] Add hash calculation for configuration change detection using crypto
- [ ] Implement error handling for state corruption scenarios
- [ ] Add first-run detection logic to avoid marking all settings as new initially

### Step 2: Enhance Type Definitions
- [ ] Update `src/types/index.ts` to add new interfaces:
  - [ ] Add `isNew?: boolean` and `seenTimestamp?: string` to `SettingDefinition`
  - [ ] Create `NewSettingsState` interface
  - [ ] Add new properties to `SettingsState` interface (`newSettingsCount`, `hasNewSettings`, `newSettingsByGroup`)
  - [ ] Create `INewSettingsTracker` interface
  - [ ] Add new message types for webview communication

### Step 3: Integrate NewSettingsTracker into Dependency Injection
- [ ] Update `src/extension.ts` to add NewSettingsTracker to ServiceContainer:
  - [ ] Add private `_newSettingsTracker?: NewSettingsTracker` property
  - [ ] Add getter method for newSettingsTracker with lazy initialization
  - [ ] Update constructor dependencies for services that need the tracker
  - [ ] Add disposal logic for the new service

## Phase 2: Service Integration

### Step 4: Enhance ConfigurationService
- [ ] Update `src/services/ConfigurationService.ts` to integrate with NewSettingsTracker:
  - [ ] Add NewSettingsTracker dependency to constructor
  - [ ] Call `initialize()` after loading configuration
  - [ ] Call `detectNewSettings()` when configuration changes
  - [ ] Fire events when new settings are detected

### Step 5: Enhance StateManager
- [ ] Update `src/utils/StateManager.ts` to include new settings data:
  - [ ] Add NewSettingsTracker dependency to constructor
  - [ ] Enhance `buildWebviewState()` to include new settings information:
    - [ ] Calculate `newSettingsCount`
    - [ ] Set `hasNewSettings` flag
    - [ ] Calculate `newSettingsByGroup` counts
    - [ ] Mark settings as new in definitions array
  - [ ] Add methods to handle new settings state management

### Step 6: Enhance WebviewProvider Message Handling
- [ ] Update `src/providers/OnByDefaultSettingsWebviewProvider.ts`:
  - [ ] Add NewSettingsTracker dependency to constructor
  - [ ] Add new message handlers in `handleMessage()`:
    - [ ] `markAsSeen` handler to mark individual settings as seen
    - [ ] `markAllAsSeen` handler to mark all settings as seen
  - [ ] Update `updateWebviewState()` to refresh after marking settings as seen
  - [ ] Add automatic mark-as-seen when users modify new setting values

## Phase 3: User Interface Implementation

### Step 7: Enhance Webview HTML Structure
- [ ] Update `media/settingsWebview.html` to add new UI elements:
  - [ ] Add new settings summary area in header
  - [ ] Add container for new settings count display
  - [ ] Add "Mark All as Seen" action button
  - [ ] Ensure proper accessibility attributes (ARIA labels, roles)

### Step 8: Implement New Setting Indicators
- [ ] Add CSS styles for new setting indicators:
  - [ ] Design "NEW" badge with VS Code theme colors
  - [ ] Create hover states and transitions
  - [ ] Ensure accessibility with proper contrast ratios
  - [ ] Add styles for new settings summary
- [ ] Add JavaScript functions for new settings:
  - [ ] `makeNewIndicator()` function to create "NEW" badges
  - [ ] `renderNewSettingsSummary()` function for header summary
  - [ ] Update existing `renderSetting()` to include new indicators
  - [ ] Add event handlers for mark-as-seen actions

### Step 9: Implement Mark-as-Seen Actions
- [ ] Add individual "Mark as Seen" buttons to new settings:
  - [ ] Create button component with appropriate styling
  - [ ] Add click handlers to send messages to extension
  - [ ] Implement immediate visual feedback (fade out indicator)
- [ ] Add bulk "Mark All as Seen" action:
  - [ ] Add button to new settings summary area
  - [ ] Implement click handler for bulk action
  - [ ] Add confirmation dialog if many settings are new
- [ ] Add automatic mark-as-seen on value change:
  - [ ] Enhance existing setting change handlers
  - [ ] Automatically mark setting as seen when user modifies value

## Phase 4: Testing and Validation

### Step 10: Unit Tests for NewSettingsTracker
- [ ] Create `src/test/NewSettingsTracker.test.ts`:
  - [ ] Test `initialize()` with empty and populated state
  - [ ] Test `detectNewSettings()` with various scenarios
  - [ ] Test `markAsSeen()` and `markAllAsSeen()` functionality
  - [ ] Test state persistence and retrieval
  - [ ] Test hash calculation and change detection
  - [ ] Test error handling for corrupt state
  - [ ] Test first-run behavior

### Step 11: Integration Tests
- [ ] Add tests to `src/test/extension.test.ts`:
  - [ ] Test new settings detection after configuration load
  - [ ] Test webview state includes new settings information
  - [ ] Test message handling for mark-as-seen actions
  - [ ] Test automatic mark-as-seen on setting value changes
  - [ ] Test state persistence across extension reloads

### Step 12: Manual Testing Scenarios
- [ ] Test first-time user experience:
  - [ ] Verify no settings are marked as new on first run
  - [ ] Verify state is properly initialized
- [ ] Test new settings detection:
  - [ ] Add new settings to remote config
  - [ ] Verify settings are marked as new
  - [ ] Verify count and summary are correct
- [ ] Test mark-as-seen functionality:
  - [ ] Test individual mark-as-seen actions
  - [ ] Test bulk mark-all-as-seen action
  - [ ] Test automatic mark-as-seen on value change
- [ ] Test state persistence:
  - [ ] Mark settings as seen, reload extension
  - [ ] Verify seen state is preserved
- [ ] Test error scenarios:
  - [ ] Corrupt state storage and verify graceful handling
  - [ ] Network errors during config load

## Phase 5: Performance and Polish

### Step 13: Performance Optimization
- [ ] Profile extension load time with new settings tracking:
  - [ ] Measure baseline performance
  - [ ] Identify any performance regressions
  - [ ] Optimize hash calculation if needed
- [ ] Optimize webview rendering:
  - [ ] Ensure new setting indicators don't slow down rendering
  - [ ] Implement efficient DOM updates for state changes
- [ ] Test memory usage:
  - [ ] Monitor extension memory usage over time
  - [ ] Verify no memory leaks in new settings tracking

### Step 14: User Experience Polish
- [ ] Enhance visual design:
  - [ ] Refine new setting indicator styling
  - [ ] Ensure consistent spacing and alignment
  - [ ] Test with different VS Code themes
- [ ] Improve accessibility:
  - [ ] Test with screen readers
  - [ ] Verify keyboard navigation works properly
  - [ ] Add appropriate ARIA labels and descriptions
- [ ] Add tooltips and help text:
  - [ ] Add tooltips explaining new setting indicators
  - [ ] Add help text for mark-as-seen actions

### Step 15: Error Handling and Edge Cases
- [ ] Handle configuration service errors:
  - [ ] Test behavior when remote config fails to load
  - [ ] Verify new settings tracking works with local config only
- [ ] Handle state storage errors:
  - [ ] Test behavior when globalState is unavailable
  - [ ] Implement fallback behavior for read/write failures
- [ ] Handle malformed configurations:
  - [ ] Test with invalid or corrupted remote configs
  - [ ] Verify graceful degradation

## Phase 6: Documentation and Deployment

### Step 16: Update Documentation
- [ ] Update README.md:
  - [ ] Document new settings notification feature
  - [ ] Add screenshots of new UI elements
  - [ ] Explain user workflow for managing new settings
- [ ] Add inline code documentation:
  - [ ] Document all new public methods and interfaces
  - [ ] Add JSDoc comments for complex algorithms
  - [ ] Update existing documentation where modified

### Step 17: Final Testing and Validation
- [ ] Run full test suite:
  - [ ] Execute `npm test` and verify all tests pass
  - [ ] Run `npm run lint` and fix any issues
  - [ ] Test extension loading and basic functionality
- [ ] Perform end-to-end testing:
  - [ ] Test complete user workflow from installation to using new features
  - [ ] Test with various remote configurations
  - [ ] Test error scenarios and recovery

### Step 18: Deployment Preparation
- [ ] Update package.json version if needed
- [ ] Update CHANGELOG.md with new feature description
- [ ] Verify no breaking changes introduced
- [ ] Test extension packaging with `vsce package`
- [ ] Verify extension works in both stable and insiders VS Code

## Phase 7: Post-Deployment Monitoring

### Step 19: Monitor and Gather Feedback
- [ ] Monitor extension performance after deployment
- [ ] Gather user feedback on new settings notification system
- [ ] Monitor for any reported issues or bugs
- [ ] Track usage metrics if available

### Step 20: Iterate and Improve
- [ ] Address any user feedback or reported issues
- [ ] Consider enhancements based on usage patterns
- [ ] Plan future improvements to the notification system
- [ ] Update documentation based on real-world usage

## Success Criteria
- [ ] All unit and integration tests pass
- [ ] Extension loads and functions normally with new feature
- [ ] New settings are properly detected and marked
- [ ] Users can mark settings as seen individually and in bulk
- [ ] State persists correctly across sessions
- [ ] Performance remains acceptable
- [ ] UI is accessible and follows VS Code design patterns
- [ ] Error handling works gracefully in all scenarios

## Rollback Plan
If issues are discovered after deployment:
- [ ] Disable new feature by commenting out NewSettingsTracker integration
- [ ] Revert webview changes to remove new UI elements
- [ ] Release hotfix with feature disabled
- [ ] Address issues and re-enable in future release