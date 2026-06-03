# Plugin Updater - Specifications & Test Requirements

## Goal
Reliable core update mechanism for all OpenCode and Claude Code plugins.

## Requirements
- [ ] **Installation Order**: Must be installed FIRST in OpenCode, as it is responsible for installing all other plugins.
- [ ] **Reliability**: Must never fail or crash, as the entire ecosystem depends on it.
- [ ] **Launch Detection (Early Launch)**: 
  - The updater exports an `earlyLaunch(configDir)` function. 
  - Hub plugins (opencode-hub / claude-hub) MUST detect the updater and call `earlyLaunch` before OpenCode invokes it, deferring update flow management to the Hub.
  - If launched directly via the normal application command (no hub / optional dependency), the updater executes its update routine automatically and MUST install the Hub.
  - Path resolution relies on the `configDir` passed by `earlyLaunch` or inferred from `process.argv`/input, NEVER relying on static environment variables like `CC_LAUNCHER`.
