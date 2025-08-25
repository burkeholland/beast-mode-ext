# Beast Mode Extension Refactoring - Implementation Plan

## Overview

This document provides a detailed, step-by-step checklist for refactoring the Beast Mode VS Code extension's `extension.ts` file. Each step is designed to be implemented incrementally while maintaining functionality.

## Pre-Implementation Setup

- [ ] Create backup of current `src/extension.ts` file
- [ ] Ensure all tests are passing before starting refactoring
- [ ] Verify extension builds and runs correctly in current state
- [ ] Create new directory structure for refactored code

## Phase 1: Project Structure Setup

### 1.1 Create Directory Structure
- [ ] Create `src/types` directory for TypeScript interfaces
- [ ] Create `src/services` directory for business logic services
- [ ] Create `src/utils` directory for utility classes  
- [ ] Create `src/providers` directory for VS Code providers

### 1.2 Create Base Type Definitions
- [ ] Create `src/types/index.ts` with core interfaces
- [ ] Move `SettingDefinition` interface to types file
- [ ] Move `SettingsState` interface to types file
- [ ] Add new service interfaces defined in technical specification
- [ ] Export all interfaces from types/index.ts

## Phase 2: Extract HTTP Service

### 2.1 Create HttpService Class
- [ ] Create `src/services/HttpService.ts` file
- [ ] Define `IHttpService` interface with methods: get, fetchGistContent, resolveToRawUrl
- [ ] Implement `HttpService` class implementing the interface
- [ ] Move HTTP request logic from extension.ts to HttpService
- [ ] Implement standardized error handling and timeout management

### 2.2 Extract HTTP-related Methods
- [ ] Move `resolveToRawUrl` method to HttpService
- [ ] Move `fetchAndCacheRemoteConfig` HTTP logic to HttpService.get method
- [ ] Move `fetchGistContent` method to HttpService
- [ ] Standardize HTTP request patterns across all methods
- [ ] Implement caching mechanism in HttpService

### 2.3 Update Extension to Use HttpService
- [ ] Import HttpService in extension.ts
- [ ] Create HttpService instance in BeastModeSettingsWebviewProvider constructor
- [ ] Replace direct HTTP calls with HttpService method calls
- [ ] Verify all HTTP functionality works correctly

## Phase 3: Extract Configuration Service

### 3.1 Create ConfigurationService Class
- [ ] Create `src/services/ConfigurationService.ts` file
- [ ] Define `IConfigurationService` interface with methods for config loading and polling
- [ ] Implement `ConfigurationService` class
- [ ] Add dependency on HttpService for remote config fetching

### 3.2 Extract Configuration Logic
- [ ] Move `loadDefinitionsFromConfigSources` method to ConfigurationService
- [ ] Move remote config polling logic to ConfigurationService
- [ ] Move `startPollingRemoteConfig` method to ConfigurationService
- [ ] Move `checkRemoteNow` method to ConfigurationService
- [ ] Implement configuration change events

### 3.3 Extract Configuration Constants
- [ ] Move polling interval and global state keys to ConfigurationService
- [ ] Move configuration file paths to ConfigurationService
- [ ] Create configuration-related utility methods

### 3.4 Update Extension to Use ConfigurationService
- [ ] Import ConfigurationService in extension.ts
- [ ] Create ConfigurationService instance with HttpService dependency
- [ ] Replace config loading calls with ConfigurationService methods
- [ ] Update polling initialization to use ConfigurationService
- [ ] Verify configuration loading works for both remote and local configs

## Phase 4: Extract Schema Inference Service

### 4.1 Create SchemaInferenceService Class
- [ ] Create `src/services/SchemaInferenceService.ts` file
- [ ] Define `ISchemaInferenceService` interface
- [ ] Implement `SchemaInferenceService` class
- [ ] Add VS Code extension context dependency

### 4.2 Extract Schema-related Methods
- [ ] Move `inferDefinitionFromSchema` method to SchemaInferenceService
- [ ] Move `findConfigSchemaForKey` method to SchemaInferenceService
- [ ] Move `deriveGroupFromKey` method to SchemaInferenceService
- [ ] Move `normalizeRequires` and `mergeRequires` helper methods
- [ ] Move `applyDefaultsToUserSettings` method to SchemaInferenceService

### 4.3 Update Configuration Service
- [ ] Add SchemaInferenceService dependency to ConfigurationService
- [ ] Update configuration loading to use SchemaInferenceService for enrichment
- [ ] Verify schema inference and defaults application works correctly

## Phase 5: Extract State Management

### 5.1 Create StateManager Class
- [ ] Create `src/utils/StateManager.ts` file
- [ ] Define `IStateManager` interface
- [ ] Implement `StateManager` class
- [ ] Add VS Code extension context dependency

### 5.2 Extract State-related Methods
- [ ] Move `collectCurrentSettings` method to StateManager
- [ ] Move state building logic from `postState` to StateManager.buildWebviewState
- [ ] Move `updateSetting` method to StateManager
- [ ] Add method for checking extension availability
- [ ] Add methods for global state management

### 5.3 Update Provider to Use StateManager
- [ ] Import StateManager in BeastModeSettingsWebviewProvider
- [ ] Create StateManager instance
- [ ] Replace state collection calls with StateManager methods
- [ ] Update message handling to use StateManager for setting updates
- [ ] Verify state management functionality works correctly

## Phase 6: Extract HTML Rendering

### 6.1 Create HtmlRenderer Class
- [ ] Create `src/utils/HtmlRenderer.ts` file
- [ ] Define `IHtmlRenderer` interface
- [ ] Implement `HtmlRenderer` class
- [ ] Add VS Code extension context dependency

### 6.2 Extract HTML-related Methods
- [ ] Move `renderHtml` method to HtmlRenderer
- [ ] Move `getCspSource` method to HtmlRenderer
- [ ] Move `generateNonce` method to HtmlRenderer
- [ ] Move HTML template loading logic to HtmlRenderer
- [ ] Implement template caching if beneficial

### 6.3 Update Provider to Use HtmlRenderer
- [ ] Import HtmlRenderer in BeastModeSettingsWebviewProvider
- [ ] Create HtmlRenderer instance
- [ ] Replace HTML rendering calls with HtmlRenderer methods
- [ ] Verify webview HTML generation works correctly

## Phase 7: Refactor Main Provider Class

### 7.1 Simplify BeastModeSettingsWebviewProvider
- [ ] Create `src/providers/BeastModeSettingsWebviewProvider.ts` file
- [ ] Move provider class to dedicated file
- [ ] Remove extracted methods from provider class
- [ ] Implement dependency injection for services
- [ ] Simplify constructor to accept service dependencies

### 7.2 Update Provider Lifecycle Methods
- [ ] Simplify `resolveWebviewView` to use injected services
- [ ] Update `startExternalWatchers` to coordinate with services
- [ ] Simplify `dispose` method to dispose of service subscriptions
- [ ] Update `handleMessage` to delegate to appropriate services

### 7.3 Update Provider State Management
- [ ] Simplify `postState` to use StateManager and HtmlRenderer
- [ ] Remove redundant state building logic
- [ ] Ensure proper error handling throughout provider

## Phase 8: Refactor Main Extension File

### 8.1 Simplify Extension Activation
- [ ] Update `src/extension.ts` to focus only on activation logic
- [ ] Implement service factory/container for dependency injection
- [ ] Create service instances with proper dependencies
- [ ] Register provider with injected services

### 8.2 Clean Up Extension File
- [ ] Remove all extracted classes and methods from extension.ts
- [ ] Keep only activation, deactivation, and service setup
- [ ] Add proper imports for all services and types
- [ ] Ensure extension.ts is under 100 lines

### 8.3 Implement Service Registration
- [ ] Create service container or factory pattern
- [ ] Set up dependency injection for services
- [ ] Ensure proper service lifecycle management
- [ ] Register all disposables correctly

## Phase 9: Final Cleanup and Optimization

### 9.1 Code Quality Improvements
- [ ] Add comprehensive JSDoc comments to all public methods
- [ ] Ensure consistent error handling patterns across all services
- [ ] Verify all TypeScript types are properly defined
- [ ] Remove any remaining code duplication

### 9.2 Performance Optimization
- [ ] Review async operations for proper error handling
- [ ] Optimize service initialization order
- [ ] Ensure proper disposal of resources
- [ ] Review caching mechanisms for efficiency

### 9.3 Documentation Updates
- [ ] Update inline code comments for clarity
- [ ] Add README documentation for new architecture
- [ ] Document service interfaces and usage patterns
- [ ] Create architecture diagram if helpful

## Phase 10: Testing and Validation

### 10.1 Functional Testing
- [ ] Test extension activation and deactivation
- [ ] Test webview rendering and interaction
- [ ] Test remote configuration loading
- [ ] Test local configuration fallback
- [ ] Test setting updates and persistence
- [ ] Test extension installation functionality
- [ ] Test configuration change detection and refresh

### 10.2 Error Condition Testing
- [ ] Test behavior with invalid remote URLs
- [ ] Test behavior with network failures
- [ ] Test behavior with malformed configuration JSON
- [ ] Test behavior with missing bundled config file
- [ ] Test behavior with VS Code API failures

### 10.3 Performance Testing
- [ ] Measure extension activation time
- [ ] Verify memory usage remains stable
- [ ] Test responsiveness of webview interactions
- [ ] Verify network request efficiency

### 10.4 Code Quality Validation
- [ ] Run ESLint and fix any warnings or errors
- [ ] Run TypeScript compiler and fix any type errors
- [ ] Verify all imports and exports are correct
- [ ] Check for any unused code or imports

## Phase 11: Final Integration

### 11.1 Build and Package Testing
- [ ] Run `npm run compile` to verify compilation
- [ ] Run `npm run lint` to verify code quality
- [ ] Run `npm test` to verify existing tests pass
- [ ] Test extension in development mode (F5)
- [ ] Test extension package installation

### 11.2 Regression Testing
- [ ] Test all existing VS Code commands work
- [ ] Verify all webview functionality works
- [ ] Test remote config URL changes
- [ ] Test file watching for local config changes
- [ ] Verify extension disposal works correctly

### 11.3 Documentation Finalization
- [ ] Update any changed API documentation
- [ ] Verify code comments are accurate
- [ ] Update architecture documentation
- [ ] Create migration notes if needed

## Success Criteria Validation

### Code Organization
- [ ] Extension.ts file is under 100 lines
- [ ] Each service file is under 200 lines
- [ ] Clear separation of concerns achieved
- [ ] Single responsibility principle followed

### Functionality Preservation
- [ ] All existing features work identically
- [ ] No performance degradation observed
- [ ] All error handling behaviors preserved
- [ ] All caching mechanisms work correctly

### Code Quality
- [ ] TypeScript compilation succeeds without errors
- [ ] ESLint passes without warnings
- [ ] All interfaces are properly typed
- [ ] Consistent coding patterns throughout

## Post-Implementation Tasks

- [ ] Update memory.instructions.md with refactoring details
- [ ] Create pull request with detailed description
- [ ] Document any lessons learned
- [ ] Plan for future unit test implementation
- [ ] Consider additional improvements for future iterations

## Notes

- Each checkbox represents a discrete task that can be completed and verified independently
- Services should be tested after each extraction to ensure functionality is preserved
- Dependency injection should be kept simple to avoid over-engineering
- All existing caching and performance optimizations must be preserved
- Error handling patterns should be consistent across all services