import * as vscode from 'vscode';
import { detectVersion } from '../compiler/finder';

/**
 * Field completions inside a project manifest.
 *
 * The manifest is Fly source, so the language server already completes types and
 * namespaces here. What it cannot offer is the SHAPE of a manifest — which
 * fields exist and how a Target or a Dependency is spelled — so this provider
 * contributes those as snippets.
 */

function field(label: string, snippet: string, doc: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Property);
    item.insertText    = new vscode.SnippetString(snippet);
    item.documentation = new vscode.MarkdownString(doc);
    return item;
}

/**
 * Fields the driver actually reads, in the order `fly` serialises them.
 *
 * Built per call: the flyVersion snippet defaults to the ACTIVE compiler's
 * version (what `fly init` would write) instead of a hardcoded number that
 * goes stale at every toolchain release; `flyVer` is "" until detected.
 */
function makeFields(flyVer: string): vscode.CompletionItem[] {
    return [
    field('name',        'string name = "${1:my-project}"',
          'Package name (REQUIRED). Must match `[a-z0-9_-]+`.'),
    field('version',     'string version = "${1:0.1.0}"',
          'Package version (REQUIRED), `MAJOR.MINOR.PATCH`.'),
    field('description', 'string description = "${1:A Fly package}"',
          'Short human-readable description.'),
    field('license',     'string license = "${1:Apache-2.0}"',
          'SPDX license identifier.'),
    field('flyVersion',  'string flyVersion = "${1' + (flyVer ? ':' + flyVer : '') + '}"',
          'The Fly toolchain version this package expects (the version reported by `fly --version`).'),
    field('homepage',    'string homepage = "${1:https://example.org}"',
          'Project homepage or documentation URL.'),
    field('repository',  'string repository = "${1:https://github.com/user/repo.git}"',
          'Source repository URL.'),
    field('registry',    'string registry = "${1:default}"',
          'Default registry alias for this package\'s dependencies.'),
    field('authors',     'string[] authors = { "${1:Name <mail@example.org>}" }',
          'Author strings.'),
    field('linkLibs',    'string[] linkLibs = { "${1:m}" }',
          'Native libraries to link (without the `-l` prefix).'),
    field('targets',     'Target[] targets = { new Target("${1:app}", "${2:src/main.fly}", "${3}") }',
          'Build targets. `(name, path, lib)` — an empty `lib` is an executable, '
        + 'else `"static"`, `"dynamic"` or `"both"`.'),
    field('dependencies', 'Dependency[] dependencies = { new Dependency("${1:name}", "${2:^1.0.0}") }',
          'Runtime dependencies. Prefer `fly add`, which also re-locks.'),
    field('devDependencies', 'Dependency[] devDependencies = { new Dependency("${1:name}", "${2:^1.0.0}") }',
          'Development-only dependencies (`fly add --dev`).'),
    ];
}

/** Constructors usable inside an array literal. */
const CONSTRUCTORS: vscode.CompletionItem[] = [
    (() => {
        const i = new vscode.CompletionItem('new Target', vscode.CompletionItemKind.Constructor);
        i.insertText    = new vscode.SnippetString('new Target("${1:app}", "${2:src/main.fly}", "${3}")');
        i.documentation = new vscode.MarkdownString(
            'One build target: `(name, path, lib)`. Empty `lib` = executable.');
        return i;
    })(),
    (() => {
        const i = new vscode.CompletionItem('new Dependency (registry)', vscode.CompletionItemKind.Constructor);
        i.insertText    = new vscode.SnippetString('new Dependency("${1:name}", "${2:^1.0.0}")');
        i.documentation = new vscode.MarkdownString('A registry dependency: `(name, version)`.');
        return i;
    })(),
    (() => {
        const i = new vscode.CompletionItem('new Dependency (git)', vscode.CompletionItemKind.Constructor);
        i.insertText    = new vscode.SnippetString(
            'new Dependency("${1:name}", "", "", "${2:https://github.com/user/repo.git}", "${3:v1.0.0}")');
        i.documentation = new vscode.MarkdownString(
            'A git dependency: `(name, version, registry, git, tag)`. Use the `branch` or '
          + '`rev` argument instead of `tag` to track a branch or pin a commit.');
        return i;
    })(),
    (() => {
        const i = new vscode.CompletionItem('new Dependency (path)', vscode.CompletionItemKind.Constructor);
        i.insertText    = new vscode.SnippetString(
            'new Dependency("${1:name}", "", "", "", "", "", "", "${2:../libs/core}")');
        i.documentation = new vscode.MarkdownString('A local path dependency (8th argument).');
        return i;
    })(),
];

/** True when the cursor sits inside an unclosed `{` on this line — an array literal. */
function insideBraces(line: string, col: number): boolean {
    const before = line.slice(0, col);
    const opens  = (before.match(/\{/g) || []).length;
    const closes = (before.match(/\}/g) || []).length;
    return opens > closes;
}

export class ManifestCompletionProvider implements vscode.CompletionItemProvider {
    // Active compiler version, detected once per compilerPath value: the
    // flyVersion snippet then offers what `fly init` would write. "" (not yet
    // detected, or no compiler) leaves the snippet placeholder empty.
    private flyVer = '';
    private detectedFor = '';

    private refreshVersion(): void {
        const compiler = vscode.workspace.getConfiguration('fly')
            .get<string>('compilerPath', 'fly');
        if (compiler === this.detectedFor) return;
        this.detectedFor = compiler;
        void detectVersion(compiler).then(v => { this.flyVer = v ?? ''; });
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.CompletionItem[] {
        // Fire-and-forget: the first request may miss the version (snippet
        // placeholder stays empty); later ones use the cached detection.
        this.refreshVersion();
        const line = document.lineAt(position.line).text;

        // Inside an array literal the useful completions are the constructors.
        if (insideBraces(line, position.character)) return CONSTRUCTORS;

        // Only offer field declarations at the start of a line inside the class body.
        if (!/^\s*[A-Za-z\[\]]*$/.test(line.slice(0, position.character))) return [];
        return makeFields(this.flyVer);
    }
}
