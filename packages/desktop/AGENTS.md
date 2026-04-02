# Desktop package notes

- Never call `invoke` manually in this package.
- Use the generated bindings in `packages/desktop/src/bindings.ts` for core commands/events.

## macOS launch debugging

- If a macOS `.app` fails to open from Finder, compare `open /Applications/<App>.app` with direct execution of `Contents/MacOS/<bin>` before changing build scripts.
- If the binary works but Finder launch exits immediately, reproduce with `cd / && /Applications/<App>.app/Contents/MacOS/<bin>` to catch startup code that depends on the current working directory or a writable relative path.
- Do not write generated files from desktop app startup unless the process is clearly running from the source tree. Codegen belongs in tests, build scripts, or source-only dev flows.
- When verifying a bundled app, check signatures for both `Contents/MacOS/OpenCode` and `Contents/MacOS/opencode-cli`; sidecar and main binary can fail independently.
- If the app process stays alive but no window appears, inspect `~/Library/Application Support/ai.opencode.desktop(.dev)/.window-state.json` for stale off-screen window coordinates.
