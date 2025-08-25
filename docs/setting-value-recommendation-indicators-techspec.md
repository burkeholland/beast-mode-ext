# Technical Specification: Setting Value Recommendation Indicators

## Overview

This technical specification defines the implementation approach for adding visual indicators when user settings values differ from recommended values in the Beast Mode VS Code extension.

## Architecture / System Design

### High-Level Architecture

The recommendation indicator feature will integrate into the existing Beast Mode extension architecture:

```
┌─────────────────────────────────────────────────┐
│                Extension.ts                     │
│              (Entry Point)                      │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│           ServiceContainer                      │
│     (Dependency Injection)                      │
└─────┬─────────┬─────────┬─────────┬─────────────┘
      │         │         │         │
      ▼         ▼         ▼         ▼
┌──────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐
│HttpSvc   │ │ConfigSvc│ │SchemaSvc│ │StateManager │
└──────────┘ └─────────┘ └─────────┘ └─────────────┘
      │         │         │         │
      └─────────┼─────────┼─────────┼────────────┐
                │         │         │            │
                ▼         ▼         ▼            ▼
        ┌──────────────────────────────────────────────┐
        │      BeastModeSettingsWebviewProvider        │
        │            (Orchestrates UI)                 │
        └────────────────┬─────────────────────────────┘
                         │
                         ▼
        ┌──────────────────────────────────────────────┐
        │            HtmlRenderer                      │
        │        (Generates Webview HTML)              │
        └────────────────┬─────────────────────────────┘
                         │
                         ▼
        ┌──────────────────────────────────────────────┐
        │         Webview (HTML/CSS/JS)                │
        │      (Renders UI with Indicators)            │
        └──────────────────────────────────────────────┘
```

### Component Modifications

#### 1. Data Model Extension (types/index.ts)
- Extend `SettingDefinition` interface to include `recommended` field
- No breaking changes to existing interfaces

#### 2. Configuration Loading (ConfigurationService.ts)
- Parse `recommended` values from config JSON during configuration parsing
- Support `recommended` field at both group and individual setting levels

#### 3. State Management (StateManager.ts)
- Add logic to compare current values with recommended values
- Include recommendation status in webview state

#### 4. HTML Rendering (HtmlRenderer.ts)
- Generate HTML with recommendation indicators
- Include indicator styling and tooltip markup

#### 5. Webview JavaScript
- Add recommendation indicator rendering logic
- Handle tooltip interactions for recommendation info

## Data Models

### Extended SettingDefinition Interface

```typescript
export interface SettingDefinition {
	// ... existing fields
	recommended?: any; // recommended value for this setting
	hasRecommendation?: boolean; // computed: whether a recommendation exists
	matchesRecommendation?: boolean; // computed: whether current value matches recommendation
}
```

### Extended SettingsState Interface

```typescript
export interface SettingsState {
	// ... existing fields
	recommendationSummary?: {
		total: number;
		matching: number;
		differing: number;
	};
}
```

### Configuration JSON Schema Extension

```json
{
  "settings": [
    {
      "group": "Copilot",
      "settings": [
        {
          "key": "chat.tools.autoApprove",
          "title": "Auto Approve Tools",
          "description": "Automatically approve tool calls in chat.",
          "type": "boolean",
          "recommended": true,
          "info": "Skips confirmations for tool usage, including terminal commands."
        }
      ]
    }
  ]
}
```

## API Design

### ConfigurationService Updates

```typescript
class ConfigurationService {
	// New method to parse recommended values
	private parseRecommendations(json: any): void {
		// Extract recommended values from config JSON
		// Support both group-level and setting-level recommendations
	}
}
```

### StateManager Updates

```typescript
class StateManager {
	// New method to evaluate recommendations
	evaluateRecommendations(definitions: SettingDefinition[]): SettingDefinition[] {
		// Compare current values with recommended values
		// Set hasRecommendation and matchesRecommendation flags
	}
	
	// Updated buildWebviewState to include recommendation data
	buildWebviewState(definitions: SettingDefinition[]): SettingsState {
		// Include recommendation summary in state
	}
}
```

### HtmlRenderer Updates

```typescript
class HtmlRenderer {
	// New method to render recommendation indicators
	private renderRecommendationIndicator(def: SettingDefinition): string {
		// Generate HTML for recommendation indicator
		// Include tooltip markup
	}
}
```

## Logic and Behaviour

### Recommendation Evaluation Logic

1. **Load Configuration**: Parse recommended values from config JSON
2. **Compare Values**: For each setting, compare current value with recommended value
3. **Type-Aware Comparison**: Handle different setting types appropriately:
   - **Boolean**: Direct equality check
   - **Number**: Equality check with type coercion
   - **String**: String equality check
   - **Options**: Check if current value is in recommended options array

### Visual Indicator Logic

1. **Display Condition**: Show indicator only when:
   - Setting has a recommended value defined
   - Current value differs from recommended value
   - Setting is not disabled due to missing extensions

2. **Indicator Style**: 
   - Yellow dot/circle positioned near the control
   - Uses VS Code theme colors for consistency
   - Non-intrusive but visible

3. **Tooltip Behavior**:
   - Show on hover and keyboard focus
   - Display "Recommended: [value]" text
   - Include reasoning if available

### State Synchronization

1. **Real-time Updates**: When user changes a setting value:
   - Immediately re-evaluate recommendation status
   - Update indicator visibility without full page reload
   - Maintain tooltip functionality

2. **Configuration Changes**: When remote config updates:
   - Re-evaluate all recommendations
   - Update indicator states
   - Preserve existing user settings

## Tech Stack & Dependencies

### Existing Dependencies (No Changes)
- VS Code Extension API
- TypeScript
- HTML/CSS/JavaScript for webview
- VS Code theming system

### New Dependencies (None Required)
- Feature uses existing infrastructure
- No new npm packages needed
- No new VS Code API usage required

### File Modifications Required
- `src/types/index.ts` - extend interfaces
- `src/services/ConfigurationService.ts` - parse recommendations
- `src/utils/StateManager.ts` - evaluate recommendations
- `src/utils/HtmlRenderer.ts` - render indicators
- `media/settingsWebview.html` - add indicator styles and logic
- `media/config.json` - add sample recommended values

## Security & Privacy Considerations

### Security
- **No New Attack Vectors**: Feature only adds visual indicators, no new data processing
- **Input Validation**: Recommended values parsed with same validation as existing config
- **XSS Prevention**: All recommendation values are properly escaped in HTML output

### Privacy
- **No Data Collection**: Feature doesn't collect or transmit user data
- **Local Processing**: All recommendation evaluation happens locally
- **Configuration Privacy**: Recommended values are part of public configuration, no sensitive data

## Performance Considerations

### Rendering Performance
- **Minimal DOM Impact**: Indicators add minimal HTML elements
- **CSS Efficiency**: Use simple CSS classes, leverage existing theme variables
- **JavaScript Optimization**: Recommendation evaluation during state building, not on each render

### Memory Usage
- **Negligible Increase**: Recommendation data adds minimal memory overhead
- **Efficient Storage**: Recommended values stored with existing setting definitions
- **No Persistent Storage**: No additional persistence layer required

### Load Time Impact
- **Synchronous Evaluation**: Recommendation checking happens during existing state building
- **No Network Calls**: All recommendation data comes from existing config sources
- **Batched Processing**: All recommendations evaluated together during state updates

### Scalability
- **Linear Complexity**: Processing scales linearly with number of settings
- **Current Scale**: ~10-20 settings, negligible performance impact
- **Future Growth**: Design supports hundreds of settings without performance degradation

## Risks & Mitigations

### Risk 1: Visual Clutter
- **Description**: Too many indicators could make UI overwhelming
- **Mitigation**: Only show indicators for differing values, use subtle visual design
- **Fallback**: Allow users to hide indicators via setting if needed

### Risk 2: Conflicting Recommendations
- **Description**: Remote config could suggest values that conflict with user's workflow
- **Mitigation**: Recommendations are suggestions only, users retain full control
- **Fallback**: Clear documentation about recommendation purpose and optional nature

### Risk 3: Breaking Changes
- **Description**: Adding recommendation support could break existing functionality
- **Mitigation**: All changes are additive, extensive backward compatibility testing
- **Fallback**: Feature flag to disable recommendations if issues arise

### Risk 4: Configuration Complexity
- **Description**: Adding recommendation fields could complicate config maintenance
- **Mitigation**: Recommendations are optional fields, existing configs continue working unchanged
- **Fallback**: Graceful degradation when recommendation data is missing or invalid

### Risk 5: Theme Compatibility
- **Description**: Indicators might not work well with all VS Code themes
- **Mitigation**: Use semantic VS Code theme colors, test with light/dark themes
- **Fallback**: Fallback indicator styles for themes with missing color definitions

### Risk 6: Accessibility Issues
- **Description**: Visual indicators might not be accessible to screen readers
- **Mitigation**: Proper ARIA labels, keyboard navigation support, semantic HTML
- **Fallback**: Text-based recommendation info in tooltips and descriptions