# Fly Programming Language — Visual Studio Code Extension

[![Build](https://github.com/fly-lang/vscode-extension/actions/workflows/publish-marketplace.yml/badge.svg)](https://github.com/fly-lang/vscode-extension/actions/workflows/publish-marketplace.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/flylang.org.fly-vscode-extension?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=flylang.org.fly-vscode-extension)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<p align="center">
  <img src="fly_logo.png" width="128" alt="Fly Language logo" />
</p>

Full language support for the [Fly programming language](https://flylang.org) in Visual Studio Code.

## Features

### Editor
- **Syntax highlighting** for `.fly` and `.fly.h` files
- **Semantic highlighting** — functions, classes, variables, parameters, and properties are coloured by their semantic role, not just by regex pattern
- **File icons** for dark and light themes
- **Auto-closing** brackets and parentheses
- **Smart folding** — AST-aware folding for function and class bodies, plus manual `// #region` / `// #endregion` markers
- **Built-in snippets** — 40+ snippets covering namespaces, functions, classes, interfaces, suites, test blocks, control flow, allocation, error handling, and common patterns (`field`, `arr`, `getset`, `list`, `iface`, …)
- **Onboarding walkthrough** — **Help → Get Started → "Get Started with Fly"** guides you through compiler setup, first program, build/run, and project management

### Testing

Fly's test system is intrinsic to the language — tests live inside production code with zero overhead in release builds.

- **`test {}`** blocks are highlighted as a control-flow keyword. They are written directly inside production functions to observe local state read-only. In release builds they are stripped completely; in test mode they are activated by an active `suite`.
- **`suite`** declarations are highlighted as type declarations (keyword + name, like `class`). Methods ending in `Test` are test-methods executed automatically; `setup` / `teardown` are lifecycle hooks recognised by exact name.
- **`case "label":`** steps inside test-methods are highlighted and distinguished from switch `case` by the string-literal label. All steps execute sequentially with isolated error scopes.
- **Snippets:** `suite` (full scaffold with setup/teardown), `testm` (test-method with a case), `testb` (inline `test {}` block), `tcase` (single case step).
- **Hover documentation** on `suite`, `test`, and `case` explains all valid contexts, including the distinction between switch-case and test-case.

### Language intelligence (via `fly-lsp`)
- **Hover** — documentation for keywords, built-in types, and user-defined symbols (functions, classes, variables)
- **Completions** — context-aware completions from the current scope and all compiled modules
- **Go to Definition** (`F12`) — jump to the declaration of any symbol
- **Go to Type Definition** — from a variable, jump to its type's class declaration
- **Go to Implementation** — from an interface, list all implementing classes
- **Find References** (`Shift+F12`) — list all usages across the project
- **Document Highlights** — highlight all occurrences of the symbol under the cursor in the current file
- **Signature Help** — parameter hints popup when typing a function call (`(` / `,`)
- **Inlay Hints** — parameter names shown inline at each call site
- **Workspace Symbols** (`Ctrl+T`) — fuzzy-search functions and classes across all compiled files
- **Document Symbols** — outline panel and breadcrumbs for the current file
- **Folding ranges** — fold functions, classes and blocks by their real extent rather than by indentation
- **Semantic tokens** — highlighting driven by what a name *resolves to*, not by the grammar alone

### Diagnostics
- **Live diagnostics** — compiler errors and warnings shown inline on save via the `$fly` problem matcher
- **Workspace diagnostics** — all `.fly` files in the project are checked at startup, not only open ones; new files are checked automatically

### Build, run & debug
- **Build** (`Ctrl+Shift+B`) — compile the current file; errors appear in the **Problems** panel
- **Run** (`Ctrl+F5`) — compile and execute in the integrated terminal
- **Debug** (`F5`) — compile with `--debug` and launch under the **lldb-dap bundled with the Fly toolchain** (`bin/lldb-dap`, next to `fly`) — no third-party debugger extension needed
- Breakpoints in `.fly` files are respected by the debugger. Note: the self-host compiler does not emit full DWARF for user programs yet, so source-level stepping is limited.

### Projects (`Manifest.fly`)
- **Manifest support** — field completions, hover docs for every manifest field, git-URL links, and CodeLens actions on each dependency
- **`fly init / build / run / test / add / remove / why / lock / clean`** from the Command Palette and the editor title bar
- The manifest is **Fly source**, not TOML — a class extending `fly.meta.Manifest` — so it gets the same highlighting and language-server support as the rest of your code

---

## Requirements

- Visual Studio Code `^1.82.0`
- [Fly compiler](https://github.com/fly-lang/fly) (`fly` and `fly-lsp` on `PATH`, or configured via settings — a release archive ships both in the same `bin/`, together with `lldb-dap` used for debugging)

## Installation

### From the Marketplace

Search for **Fly Programming Language** in the Extensions panel (`Ctrl+Shift+X`) or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=flylang.org.fly-vscode-extension).

### From a `.vsix` file

Download the latest `.vsix` from [GitHub Releases](https://github.com/fly-lang/vscode-extension/releases), then run:

```bash
code --install-extension fly-vscode-extension-<version>.vsix
```

or drag and drop the file into the Extensions panel.

## Building from Source

```bash
git clone https://github.com/fly-lang/vscode-extension.git
cd vscode-extension
npm install
npm run compile
npm run package        # produces fly-vscode-extension-<version>.vsix
```

To run in development mode, open the folder in VS Code and press **F5**. This compiles the extension and launches an Extension Development Host window.

## Settings

| Setting | Default | Description |
|---|---|---|
| `fly.compilerPath` | `fly` | Path to the Fly compiler binary |
| `fly.lspPath` | _(auto)_ | Path to `fly-lsp`; auto-discovered next to `fly.compilerPath` |
| `fly.enableLsp` | `true` | Enable the language server (hover, go-to-definition, references, inlay hints, semantic tokens, workspace symbols, …) |
| `fly.enableDiagnostics` | `true` | Run compiler on save and show inline diagnostics |
| `fly.enableWorkspaceDiagnostics` | `true` | Scan all `.fly` files in the workspace at startup |
| `fly.buildArgs` | _(empty)_ | Extra flags appended to `fly` when running **Fly: Build File** |
| `fly.debugBuildArgs` | `--debug` | Compiler flags used by **Fly: Debug File** |
| `fly.projectProfile` | _(empty = debug)_ | Profile for the project commands: empty or `release` |
| `fly.projectForceRebuild` | `false` | Pass `--force` to **Fly: Build Project**, bypassing the fingerprint cache |
| `fly.projectBuildArgs` | _(empty)_ | Extra flags appended to `fly build`, e.g. `--target mybin` |

Use **Fly: Select Compiler** from the Command Palette to pick the compiler interactively — the extension auto-discovers all Fly installations and updates `fly.lspPath` automatically.

The status bar shows two items when a `.fly` file is active: `$(tools) fly X.Y.Z` (compiler version, click to change) and `$(check) LSP` / `$(error) LSP` (language server connection state).

## Commands

Open the Command Palette with `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS) and type **Fly** to filter.

### Compiler commands — active on `.fly` files

| Command | Shortcut | Description |
|---|---|---|
| **Fly: Select Compiler** | — | Open a quick-pick to choose the active Fly installation. Auto-fills `fly.lspPath` from the same directory. |
| **Fly: Build File** | `Ctrl+Shift+B` | Compile the current `.fly` file. Errors appear in the **Problems** panel via the `$fly` problem matcher. |
| **Fly: Run File** | `Ctrl+F5` | Compile and immediately run the current `.fly` file in the integrated terminal. Uses `&&` — the program is not launched if compilation fails. |
| **Fly: Debug File** | `F5` | Compile with `--debug` and launch the program under the toolchain's bundled `lldb-dap`. Breakpoints in `.fly` files are respected. |

The **Debug** `$(debug-alt)`, **Run** `$(run)`, and **Build** `$(play)` buttons appear in the editor title bar whenever a `.fly` file is active.

### Project commands — active in a project with a `Manifest.fly`

Every command runs in the directory holding the manifest, which is found by
walking up from the active file.

| Command | Shortcut | Description |
|---|---|---|
| **Fly: Init Project** | — | Run `fly init` to scaffold `Manifest.fly` and `src/main.fly`. |
| **Fly: Build Project** | `Ctrl+Shift+B` | Run `fly build`. Errors appear in the **Problems** panel. Only changed targets are recompiled. |
| **Fly: Run Project** | — | Run `fly run`. |
| **Fly: Test Project** | — | Run `fly test` — builds and runs the project's `*Suite.fly` files. |
| **Fly: Add Dependency** | — | Interactive: package name, git URL, ref type (`tag` / `branch` / `rev`), and whether it is a dev-dependency; then `fly add`, which also re-locks. |
| **Fly: Remove Dependency** | — | Run `fly remove <name>` and re-lock. |
| **Fly: Why Is This Dependency Here?** | — | Run `fly why <name>` to explain a package's presence in the graph. |
| **Fly: Select Profile** | — | Choose `debug` or `release` for the commands above. |
| **Fly: Clean Project** | — | Run `fly clean` for the active profile. |
| **Fly: Lock (Update Lock.fly)** | — | Run `fly lock` to re-resolve dependencies and regenerate `Lock.fly`. |

The **Run** `$(run-above)` and **Build** `$(play)` buttons appear in the editor title bar when `Manifest.fly` is open.

Each dependency in the manifest also carries **Why** and **Remove** CodeLens actions, and the `dependencies` declaration carries **Add Dependency**.

> `fly add` writes a **git** dependency: the driver requires exactly one of
> `--tag` / `--branch` / `--rev` and takes no version, so registry dependencies
> are added by editing `dependencies` in the manifest (completions offer the
> shape) and running **Fly: Lock**.

## Keyboard Shortcuts

| Shortcut | Action | Context |
|---|---|---|
| `Ctrl+Shift+B` / `Cmd+Shift+B` | **Fly: Build File** | `.fly` file active |
| `Ctrl+F5` / `Cmd+F5` | **Fly: Run File** | `.fly` file active |
| `F5` | **Fly: Debug File** | `.fly` file active, not already in debug |
| `Ctrl+Shift+B` / `Cmd+Shift+B` | **Fly: Build Project** | `Manifest.fly` active |
| `F12` | Go to Definition | `.fly` file |
| `Shift+F12` | Find References | `.fly` file |
| `Alt+Shift+→` | Expand Selection | `.fly` file |
| `Ctrl+T` / `Cmd+T` | Workspace Symbols | anywhere |

## Troubleshooting

### "fly-lsp not found" warning in the status bar

The extension cannot find the `fly-lsp` binary next to the Fly compiler. Options:
1. Ensure `fly-lsp` is in the same directory as `fly` and both are on your `PATH`.
2. Set `fly.lspPath` explicitly in VS Code settings to the full path of the `fly-lsp` binary.
3. Run **Fly: Select Compiler** — the extension will auto-fill `fly.lspPath` if `fly-lsp` is a sibling binary.

### Compiler not found / status bar shows `$(warning) fly (not found)`

`fly` is not on `PATH` or the configured `fly.compilerPath` is wrong. Run **Fly: Select Compiler** to search installed Fly versions automatically.

### Debug (`F5`) shows "lldb-dap not found"

Debugging uses the `lldb-dap` binary shipped with the Fly toolchain, expected next to the `fly` binary. Check that `fly.compilerPath` points into a full toolchain installation (`bin/` containing `fly`, `fly-lsp`, `lldb-dap`), or run **Fly: Select Compiler**.

### Diagnostics appear only for open files

Enable `fly.enableWorkspaceDiagnostics` (default: `true`) to scan the entire workspace at startup.

### The LSP status bar shows `$(error) LSP` or `$(circle-slash) LSP`

- `$(circle-slash)`: LSP is disabled — set `fly.enableLsp` to `true`.
- `$(error)`: the server crashed or stopped — check the **Fly Language Server** output channel (View → Output → Fly Language Server) for the error.

## Contributing

### Running the extension in development mode

```bash
git clone https://github.com/fly-lang/vscode-extension.git
cd vscode-extension
npm install
```

Open the folder in VS Code and press **F5**. This compiles the TypeScript and launches an **Extension Development Host** window with the extension loaded from source. Any change to the TypeScript source requires re-running `npm run compile` (or using `npm run watch` for incremental rebuilds).

### Building the `fly-lsp` language server

There is no separate build step and no CMake target for it: `fly-lsp` is written
in Fly and compiled by the Fly toolchain itself, so it comes out of the ordinary
toolchain build. From a checkout of the [Fly compiler
repository](https://github.com/fly-lang/fly), on the release branch matching
your toolchain:

```bash
./ci/linux/stage0.sh && ./ci/linux/stage1.sh && ./ci/linux/stage2.sh
```

On Windows, the same three scripts under `ci/windows/` (`stage0.ps1`,
`stage1.ps1`, `stage2.ps1`), run with **pwsh 7**.

The binaries land side by side in `build/stage2/bin/` — `fly`, `fly-lsp`,
`fly-registry` and the debugger (`lldb`, `lldb-dap`) — which is exactly the
layout of a release archive. So once `fly.compilerPath` points at a `fly`, the
extension finds `fly-lsp` and `lldb-dap` next to it and `fly.lspPath` can stay
empty.

### Reporting issues

Please open an issue at [github.com/fly-lang/vscode-extension/issues](https://github.com/fly-lang/vscode-extension/issues) with:
- VS Code version
- Extension version (shown in the Extensions panel)
- Contents of the **Fly Language Server** output channel
- Steps to reproduce

## Releasing

See [RELEASING.md](RELEASING.md) for the CI/CD workflow, how to publish a new version to the Marketplace, and the secrets that must be configured in the repository.

## Links

- [Fly language website](https://flylang.org)
- [Fly compiler repository](https://github.com/fly-lang/fly)
- [Report an issue](https://github.com/fly-lang/vscode-extension/issues)

## License

[Apache-2.0](LICENSE)
