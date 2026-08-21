import * as vscode from 'vscode';

/**
 * Hover documentation for a project manifest.
 *
 * `Manifest.fly` is ordinary Fly source — a class extending `fly.meta.Manifest`
 * — so the language server already answers hover for its syntax. What it cannot
 * know is what each FIELD MEANS to the package manager, which is what this
 * provider adds.
 */

interface FieldDoc { detail: string; doc: string; }

const FIELDS: Record<string, FieldDoc> = {
    name: {
        detail: 'string name',
        doc:    'The package name (REQUIRED). Must match `[a-z0-9_-]+`.\n\n'
              + 'On a `Target`, the first argument is the output name instead.',
    },
    version: {
        detail: 'string version',
        doc:    'The package version (REQUIRED). `MAJOR.MINOR.PATCH`, e.g. `"0.1.0"`.\n\n'
              + 'On a `Dependency`, the second argument is a version REQUIREMENT and the '
              + 'resolver picks the highest available version satisfying it.\n\n'
              + '| Syntax | Meaning |\n|---|---|\n'
              + '| `"*"` | Any (latest) |\n'
              + '| `"1.2.3"` | Exact |\n'
              + '| `"^1.2.3"` | `>=1.2.3, <2.0.0` |\n'
              + '| `"~1.2.3"` | `>=1.2.3, <1.3.0` |\n'
              + '| `"1.x"` | `>=1.0.0, <2.0.0` |',
    },
    description: {
        detail: 'string description',
        doc:    'A short, human-readable description of the package.',
    },
    license: {
        detail: 'string license',
        doc:    'SPDX license identifier, e.g. `"Apache-2.0"`, `"MIT"`, `"GPL-3.0-only"`.',
    },
    flyVersion: {
        detail: 'string flyVersion',
        doc:    'The Fly toolchain version this package expects — the version reported '
              + 'by `fly --version`. `fly init` fills it in with the version that '
              + 'scaffolded the project.',
    },
    homepage: {
        detail: 'string homepage',
        doc:    'URL of the project homepage or documentation site.',
    },
    repository: {
        detail: 'string repository',
        doc:    'URL of the source repository, e.g. `"https://github.com/user/repo.git"`.',
    },
    registry: {
        detail: 'string registry',
        doc:    'Default registry alias for this package\'s dependencies. '
              + 'Empty means the default registry.',
    },
    authors: {
        detail: 'string[] authors',
        doc:    'Author strings, e.g. `{ "Alice <alice@example.com>" }`.',
    },
    linkLibs: {
        detail: 'string[] linkLibs',
        doc:    'Native libraries to link into every target, without the `-l` prefix.\n\n'
              + '```fly\nstring[] linkLibs = { "m", "pthread" }\n```',
    },
    targets: {
        detail: 'Target[] targets',
        doc:    'The build targets — binaries and libraries.\n\n'
              + '```fly\nTarget[] targets = {\n'
              + '    new Target("app", "src/main.fly", ""),\n'
              + '    new Target("mylib", "src/lib.fly", "static")\n'
              + '}\n```\n\n'
              + 'Arguments are `(name, path, lib)`. An empty `lib` makes the target an '
              + '**executable**; `"static"`, `"dynamic"` or `"both"` make it a library.\n\n'
              + 'The name is what `fly build --target <name>` and `fly run --bin <name>` select.',
    },
    dependencies: {
        detail: 'Dependency[] dependencies',
        doc:    'Runtime dependencies. Arguments are positional — '
              + '`(name, version, registry, git, tag, branch, rev, path)` — and trailing '
              + 'ones may be omitted.\n\n'
              + '```fly\nDependency[] dependencies = {\n'
              + '    new Dependency("json", "^1.2.0"),                                  // registry\n'
              + '    new Dependency("util", "", "", "https://github.com/acme/util", "v1.0"),  // git tag\n'
              + '    new Dependency("core", "", "", "", "", "", "", "../libs/core")     // path\n'
              + '}\n```\n\n'
              + 'Edit with `fly add` / `fly remove`, then `fly lock` rewrites `Lock.fly`.',
    },
    devDependencies: {
        detail: 'Dependency[] devDependencies',
        doc:    'Same shape as `dependencies`, but not propagated to packages that depend '
              + 'on yours — available only for local development and testing '
              + '(`fly add --dev`).',
    },
    profiles: {
        detail: 'Profile[] profiles — NOT READ YET',
        doc:    '⚠️ The current `fly` driver does **not** read this field: declaring it is '
              + 'accepted but has no effect.\n\n'
              + '`--release` uses the built-in profile (`-O3`, no debug info, assertions off) '
              + 'and the default is `-O0` with debug info and assertions on.',
    },
    repositories: {
        detail: 'Registry[] repositories — NOT READ YET',
        doc:    '⚠️ The current `fly` driver does **not** read this field.\n\n'
              + 'Registry aliases map a short name to a registry URL. To serve packages '
              + 'yourself: `fly-registry --storage ~/.fly/registry --port 5000`',
    },
    tst: {
        detail: 'TestConfig tst — NOT READ YET',
        doc:    '⚠️ The current `fly` driver does **not** read this field. '
              + '(Named `tst` because `test` is a reserved keyword.)\n\n'
              + '`fly test` discovers the project\'s `*Suite.fly` files instead.',
    },
    workspace: {
        detail: 'Workspace workspace — NOT READ YET',
        doc:    '⚠️ The current `fly` driver does **not** read this field, so a workspace '
              + 'root does not yet build its members.',
    },
    hooks: {
        detail: 'Hooks hooks — NOT READ YET',
        doc:    '⚠️ The current `fly` driver does **not** read this field: pre/post-build '
              + 'commands are not run.',
    },
};

const TYPES: Record<string, FieldDoc> = {
    Manifest: {
        detail: 'class Manifest : fly.meta.Manifest',
        doc:    'The project manifest. It is **Fly source, not TOML**: the package manager '
              + 'reads it with the compiler\'s own parser and walks the AST, so one language '
              + 'and one parser cover both the code and its configuration.\n\n'
              + 'Create one with `fly init`.',
    },
    Target: {
        detail: 'new Target(name, path, lib)',
        doc:    'One build target. `lib` is `""` for an executable, else `"static"`, '
              + '`"dynamic"` or `"both"`.',
    },
    Dependency: {
        detail: 'new Dependency(name, version, registry, git, tag, branch, rev, path)',
        doc:    'One dependency. Set the arguments that fit its kind: `version` for a '
              + 'registry dependency, `git` plus exactly one of `tag`/`branch`/`rev` for a '
              + 'git dependency, or `path` for a local one. Trailing arguments may be omitted.',
    },
    Profile: {
        detail: 'new Profile(name, optLevel, debugInfo, assertions, lto, strip)',
        doc:    'A named build profile. ⚠️ Declared in the schema but **not read** by the '
              + 'current driver — only the built-in `debug` and `--release` profiles apply.',
    },
    Registry: {
        detail: 'new Registry(name, url)',
        doc:    'A registry alias mapping a short name to a registry URL. Used inside the '
              + '`repositories` field (**not read** by the current driver).',
    },
    Workspace: {
        detail: 'new Workspace(members)',
        doc:    'A multi-package workspace root. ⚠️ **Not read** by the current driver.',
    },
    Hooks: {
        detail: 'new Hooks(preBuild, postBuild)',
        doc:    'Shell commands run around the build. ⚠️ **Not read** by the current driver.',
    },
    TestConfig: {
        detail: 'TestConfig — test-run configuration',
        doc:    'Configuration for `fly test` in the `tst` field. ⚠️ **Not read** by the '
              + 'current driver — suites are discovered from `*Suite.fly` files.',
    },
};

export class ManifestHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.Hover | undefined {
        const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
        if (!wordRange) return undefined;

        const word  = document.getText(wordRange);
        const entry = FIELDS[word] ?? TYPES[word];
        if (!entry) return undefined;

        const md = new vscode.MarkdownString();
        md.appendCodeblock(entry.detail, 'fly');
        md.appendMarkdown('\n\n' + entry.doc);
        return new vscode.Hover(md, wordRange);
    }
}
