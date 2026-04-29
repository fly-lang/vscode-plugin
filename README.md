# Fly Language Support for Visual Studio Code

[![Build](https://github.com/fly-lang/vscode-extension/actions/workflows/vscode-extension.yml/badge.svg)](https://github.com/fly-lang/vscode-extension/actions/workflows/vscode-extension.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/flylang.org.fly-vscode-extension?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=flylang.org.fly-vscode-extension)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<p align="center">
  <img src="fly_logo.png" width="128" alt="Fly Language logo" />
</p>

Full language support for the [Fly programming language](https://flylang.org) in Visual Studio Code.

## Features

- **Syntax highlighting** for `.fly` and `.fly.h` files
- **File icons** for dark and light themes
- **Auto-closing** brackets and parentheses
- **Block folding** and block comment support
- **25 built-in snippets** covering declarations, control flow, memory management, and error handling

## Snippets

| Prefix    | Description                        |
|-----------|------------------------------------|
| `ns`      | Namespace declaration              |
| `import`  | Import declaration                 |
| `importas`| Import with alias                  |
| `fn`      | Function declaration               |
| `pfn`     | Public function declaration        |
| `class`   | Class declaration                  |
| `classx`  | Class with base class              |
| `struct`  | Struct declaration                 |
| `iface`   | Interface declaration              |
| `enum`    | Enum declaration                   |
| `if`      | If statement                       |
| `ife`     | If / else statement                |
| `ifee`    | If / elsif / else statement        |
| `switch`  | Switch statement                   |
| `for`     | For loop                           |
| `forin`   | For-in loop                        |
| `while`   | While loop                         |
| `new`     | Object creation                    |
| `newu`    | Unique smart pointer creation      |
| `news`    | Shared smart pointer creation      |
| `ret`     | Return statement                   |
| `fail`    | Fail (throw error) statement       |
| `handle`  | Handle block                       |
| `//`      | Line comment                       |
| `/**`     | Block doc comment                  |

## Requirements

- Visual Studio Code `^1.80.0`

## Installation

### From the Marketplace

Search for **Fly Language Support** in the Extensions panel (`Ctrl+Shift+X`) or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=flylang.org.fly-vscode-extension).

### From a `.vsix` file

Download the latest `.vsix` from [GitHub Releases](https://github.com/fly-lang/vscode-extension/releases), then run:

```bash
code --install-extension vscode-fly-<version>.vsix
```

or drag and drop the file into the Extensions panel.

## Building from Source

```bash
git clone https://github.com/fly-lang/vscode-extension.git
cd vscode-extension
npm ci
npm run compile
npm run package        # produces vscode-fly-<version>.vsix
```

## Links

- [Fly language website](https://flylang.org)
- [Fly compiler repository](https://github.com/fly-lang/fly)
- [Report an issue](https://github.com/fly-lang/vscode-extension/issues)

## License

[Apache-2.0](LICENSE)
