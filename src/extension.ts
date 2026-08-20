import * as fs    from 'fs';
import * as os    from 'os';
import * as path  from 'path';
import * as vscode from 'vscode';
import { FlyDocumentSymbolProvider } from './providers/documentSymbol';
import { FlyHoverProvider }          from './providers/hover';
import { FlyCompletionProvider }     from './providers/completion';
import { FlyDiagnosticsProvider }    from './providers/diagnostics';
import { startLspClient, stopLspClient } from './lsp/client';
import { findFlyInstallations, detectVersion, deriveLspPath, deriveDapPath } from './compiler/finder';
import { createStatusBar, refresh as refreshStatusBar } from './compiler/statusBar';
import { resolveFlyPath, resolveManifestDir, isManifest, MANIFEST_GLOB } from './project/finder';
import { ManifestCompletionProvider }   from './project/completions';
import { ManifestHoverProvider }        from './project/hover';
import { ManifestDiagnosticsProvider }  from './project/diagnostics';
import { ManifestCodeLensProvider }     from './project/codeLens';
import { ManifestDocumentLinkProvider } from './project/documentLink';
// Pure arg/path logic lives in core/toolchain (unit-tested without vscode).
import { singleFileArgs } from './core/toolchain';

const FLY_SELECTOR: vscode.DocumentSelector = { language: 'fly', scheme: 'file' };

// A manifest IS a .fly file, so it is selected by name rather than by language.
const MANIFEST_SELECTOR: vscode.DocumentSelector = {
    language: 'fly', scheme: 'file', pattern: MANIFEST_GLOB,
};

export function activate(context: vscode.ExtensionContext): void {
    // ── Compiler selection command ─────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('fly.selectCompiler', async () => {
            const config    = vscode.workspace.getConfiguration('fly');
            const current   = config.get<string>('compilerPath', 'fly');

            // Discover installations in the background while showing the picker
            const installations = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'Searching for Fly installations…' },
                () => findFlyInstallations(),
            );

            type Item = vscode.QuickPickItem & { fsPath?: string };
            const items: Item[] = [
                ...installations.map(i => ({
                    label:       `$(tools) fly ${i.version}`,
                    description: i.path,
                    detail:      i.path === current ? '$(check) Currently selected' : undefined,
                    fsPath:      i.path,
                })),
                {
                    label:       '$(folder-opened) Browse…',
                    description: 'Select a custom fly binary path',
                },
            ];

            const picked = await vscode.window.showQuickPick(items, {
                title:            'Select Fly Compiler',
                placeHolder:      'Choose a Fly installation or browse…',
                matchOnDescription: true,
            });
            if (!picked) return;

            let newPath: string;
            if (picked.fsPath) {
                newPath = picked.fsPath;
            } else {
                const uri = await vscode.window.showOpenDialog({
                    canSelectFiles:   true,
                    canSelectFolders: false,
                    openLabel:        'Select fly binary',
                });
                if (!uri || uri.length === 0) return;
                newPath = uri[0].fsPath;
            }

            // Validate before saving
            const version = await detectVersion(newPath);
            if (!version) {
                vscode.window.showErrorMessage(
                    `"${newPath}" does not appear to be a valid Fly compiler (fly --version failed).`
                );
                return;
            }

            await config.update('compilerPath', newPath, vscode.ConfigurationTarget.Global);
            // Always sync lspPath to the new compiler directory so a stale path
            // from a previous installation never persists.
            const derivedLsp = deriveLspPath(newPath);
            await config.update('lspPath', derivedLsp, vscode.ConfigurationTarget.Global);

            if (!fs.existsSync(derivedLsp)) {
                vscode.window.showWarningMessage(
                    `fly-lsp not found at "${derivedLsp}". ` +
                    `LSP features (go-to-definition, hover on symbols) will be disabled. ` +
                    `Set fly.lspPath manually if the server is installed elsewhere.`,
                );
            }

            void refreshStatusBar(vscode.window.activeTextEditor);
            vscode.window.showInformationMessage(`Fly compiler set to ${newPath} (v${version})`);
        }),
    );

    // ── Build command ──────────────────────────────────────────────────────
    // Uses vscode.tasks.executeTask() so errors appear in the Problems panel
    // via the $fly problem matcher.
    context.subscriptions.push(
        vscode.commands.registerCommand('fly.buildFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'fly') {
                vscode.window.showWarningMessage('Fly: Open a .fly file to build.');
                return;
            }
            await editor.document.save();

            const cfg        = vscode.workspace.getConfiguration('fly');
            const compiler   = cfg.get<string>('compilerPath', 'fly');
            const extraArgs  = cfg.get<string>('buildArgs', '').trim();
            const filePath   = editor.document.uri.fsPath;
            const q          = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
            const cmd        = [compiler, '--entry', q(filePath),
                                '--src-dir', q(path.dirname(filePath)),
                                extraArgs].filter(Boolean).join(' ');

            const task = new vscode.Task(
                { type: 'fly', task: 'build' },
                vscode.TaskScope.Workspace,
                'Build File',
                'fly',
                new vscode.ShellExecution(cmd),
                '$fly',
            );
            task.presentationOptions = {
                reveal: vscode.TaskRevealKind.Always,
                panel:  vscode.TaskPanelKind.Shared,
                clear:  true,
            };
            await vscode.tasks.executeTask(task);
        }),
    );

    // ── Run command (compile + execute in one terminal) ───────────────────
    let runTerminal: vscode.Terminal | undefined;
    context.subscriptions.push(
        vscode.commands.registerCommand('fly.runFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'fly') {
                vscode.window.showWarningMessage('Fly: Open a .fly file to run.');
                return;
            }
            await editor.document.save();

            const cfg        = vscode.workspace.getConfiguration('fly');
            const compiler   = cfg.get<string>('compilerPath', 'fly');
            const filePath   = editor.document.uri.fsPath;

            // Output binary in the system temp dir to avoid polluting the project.
            const baseName   = path.basename(filePath, '.fly');
            const outPath    = path.join(os.tmpdir(), baseName);
            const q          = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
            const compileCmd = `${q(compiler)} --entry ${q(filePath)} ` +
                               `--src-dir ${q(path.dirname(filePath))} -o ${q(outPath)}`;
            const runCmd     = q(outPath);

            if (!runTerminal || runTerminal.exitStatus !== undefined) {
                runTerminal = vscode.window.createTerminal('Fly Run');
            }
            runTerminal.show(false);   // false = focus the terminal
            // Compile first; only run if compilation succeeds (&&).
            runTerminal.sendText(`${compileCmd} && ${runCmd}`);
        }),
    );

    // ── Manifest.fly providers ────────────────────────────────────────────
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(MANIFEST_SELECTOR, new ManifestCompletionProvider()),
        vscode.languages.registerHoverProvider(MANIFEST_SELECTOR, new ManifestHoverProvider()),
        vscode.languages.registerCodeLensProvider(MANIFEST_SELECTOR, new ManifestCodeLensProvider()),
        vscode.languages.registerDocumentLinkProvider(MANIFEST_SELECTOR, new ManifestDocumentLinkProvider()),
    );

    const manifestDiag         = vscode.languages.createDiagnosticCollection('fly-manifest');
    const manifestDiagProvider = new ManifestDiagnosticsProvider(manifestDiag);
    context.subscriptions.push(manifestDiag);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (isManifest(doc)) manifestDiagProvider.run(doc);
        }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (isManifest(doc)) manifestDiagProvider.run(doc);
        }),
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (isManifest(doc)) manifestDiagProvider.clear(doc.uri);
        }),
    );
    for (const doc of vscode.workspace.textDocuments) {
        if (isManifest(doc)) manifestDiagProvider.run(doc);
    }

    // ── Project commands (fly build / run / test / …) ─────────────────────
    //
    // The compiler IS the package manager: there is no separate binary, and the
    // subcommands below are exactly the ones the self-hosted driver implements.
    // Anything else it rejects as an unknown argument, so nothing here offers a
    // button that cannot work.
    let projectTerminal: vscode.Terminal | undefined;

    function runFly(args: string[]): void {
        const projectDir = resolveManifestDir();
        if (!projectDir) {
            vscode.window.showWarningMessage(
                'Fly: no Manifest.fly found in this workspace. Run "Fly: Init Project" to create one.');
            return;
        }
        const fly = resolveFlyPath();
        const cmd = [fly, ...args].join(' ');

        if (!projectTerminal || projectTerminal.exitStatus !== undefined) {
            projectTerminal = vscode.window.createTerminal('Fly');
        }
        projectTerminal.show(true);
        // The driver reads the manifest from the CURRENT directory only.
        projectTerminal.sendText(`cd "${projectDir.replace(/"/g, '\\"')}" && ${cmd}`);
    }

    /**
     * Returns ['--release'] when the release profile is selected, else [].
     *
     * Only debug and release exist: the manifest reader does not consume the
     * schema's `profiles` field yet, so a custom `--profile <name>` would fall
     * back to the built-in defaults anyway.
     */
    function profileArgs(): string[] {
        const p = vscode.workspace.getConfiguration('fly').get<string>('projectProfile', '').trim();
        return p === 'release' ? ['--release'] : [];
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('fly.pkgBuild', async () => {
            const projectDir = resolveManifestDir();
            if (!projectDir) {
                vscode.window.showWarningMessage(
                    'Fly: no Manifest.fly found in this workspace. Run "Fly: Init Project" to create one.');
                return;
            }
            const fly   = resolveFlyPath();
            const cfg   = vscode.workspace.getConfiguration('fly');
            const extra = cfg.get<string>('projectBuildArgs', '').trim();
            const force = cfg.get<boolean>('projectForceRebuild', false);
            // --force bypasses the per-target fingerprint cache; no clean needed.
            const buildArgs = ['build', ...profileArgs(), ...(force ? ['--force'] : []),
                               ...(extra ? extra.split(/\s+/) : [])];
            const cmd = `cd "${projectDir.replace(/"/g, '\\"')}" && ${fly} ${buildArgs.join(' ')}`;

            const task = new vscode.Task(
                { type: 'fly', task: 'project-build' },
                vscode.TaskScope.Workspace,
                'Fly Build Project',
                'fly',
                new vscode.ShellExecution(cmd),
                '$fly',
            );
            task.presentationOptions = {
                reveal: vscode.TaskRevealKind.Always,
                panel:  vscode.TaskPanelKind.Shared,
                clear:  true,
            };
            await vscode.tasks.executeTask(task);
        }),
        vscode.commands.registerCommand('fly.pkgRun',  () => runFly(['run',  ...profileArgs()])),
        vscode.commands.registerCommand('fly.pkgTest', () => runFly(['test', ...profileArgs()])),
        vscode.commands.registerCommand('fly.pkgClean', () => runFly(['clean', ...profileArgs()])),
        vscode.commands.registerCommand('fly.pkgLock', () => runFly(['lock'])),
        vscode.commands.registerCommand('fly.pkgInit', async () => {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) {
                vscode.window.showWarningMessage('Fly: open a folder first.');
                return;
            }
            const root = folders[0].uri.fsPath;
            const name = await vscode.window.showInputBox({
                prompt: 'Package name',
                value: path.basename(root),
                validateInput: v => /^[a-z0-9_-]+$/.test(v) ? undefined : 'Name must match [a-z0-9_-]+',
            });
            if (!name) return;
            const version = await vscode.window.showInputBox({
                prompt: 'Package version', value: '0.1.0',
                validateInput: v => /^\d+\.\d+\.\d+$/.test(v) ? undefined : 'Use MAJOR.MINOR.PATCH',
            });
            if (!version) return;

            const fly = resolveFlyPath();
            if (!projectTerminal || projectTerminal.exitStatus !== undefined) {
                projectTerminal = vscode.window.createTerminal('Fly');
            }
            projectTerminal.show(true);
            projectTerminal.sendText(
                `cd "${root.replace(/"/g, '\\"')}" && ${fly} init --name ${name} --version ${version}`);
        }),
        vscode.commands.registerCommand('fly.pkgRemove', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Dependency to remove',
                validateInput: v => /^[a-z0-9_-]+$/.test(v) ? undefined : 'Name must match [a-z0-9_-]+',
            });
            if (!name) return;
            runFly(['remove', name]);
        }),
        vscode.commands.registerCommand('fly.pkgWhy', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Explain why this package is in the dependency graph',
                validateInput: v => /^[a-z0-9_-]+$/.test(v) ? undefined : 'Name must match [a-z0-9_-]+',
            });
            if (!name) return;
            runFly(['why', name]);
        }),
        vscode.commands.registerCommand('fly.pkgSelectProfile', async () => {
            const current = vscode.workspace.getConfiguration('fly')
                .get<string>('projectProfile', '') || 'debug';

            // Only these two: the manifest reader does not consume the schema's
            // `profiles` field yet, so a custom name would change nothing.
            const items = ['debug', 'release'].map(p => ({
                label:       p,
                description: p === current ? '$(check) active' : undefined,
            }));

            const picked = await vscode.window.showQuickPick(items, {
                title:       'Fly: Select Build Profile',
                placeHolder: 'Profile used by Fly: Build / Run / Test',
            });
            if (!picked) return;

            const value = picked.label === 'debug' ? '' : picked.label;
            await vscode.workspace.getConfiguration('fly').update(
                'projectProfile', value, vscode.ConfigurationTarget.Workspace,
            );
            vscode.window.showInformationMessage(`Fly profile set to "${picked.label}".`);
        }),
        // Used by the CodeLens actions in Manifest.fly (Why / Remove dependency).
        vscode.commands.registerCommand('fly.pkgRunCmd', (args: string[]) => runFly(args)),
        // `fly add` writes a GIT dependency: it requires exactly one of
        // --tag/--branch/--rev and takes no version, so a registry dependency is
        // added by editing `dependencies` in the manifest directly.
        vscode.commands.registerCommand('fly.pkgAdd',  async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Dependency name (e.g. my-lib)',
                validateInput: v => /^[a-z0-9_-]+$/.test(v) ? undefined : 'Name must match [a-z0-9_-]+',
            });
            if (!name) return;

            const gitUrl = await vscode.window.showInputBox({
                prompt: 'Git repository URL (e.g. https://github.com/user/repo.git)',
                validateInput: v => v.startsWith('http') || v.startsWith('git@') ? undefined : 'Enter a valid git URL',
            });
            if (!gitUrl) return;

            const refType = await vscode.window.showQuickPick(
                ['tag', 'branch', 'rev'],
                { placeHolder: 'Reference type' },
            );
            if (!refType) return;

            const refLabel = refType === 'tag' ? 'Tag (e.g. v1.0.0)' :
                             refType === 'branch' ? 'Branch name (e.g. main)' :
                             'Commit hash (40 characters)';
            const refValue = await vscode.window.showInputBox({ prompt: refLabel });
            if (!refValue) return;

            const kind = await vscode.window.showQuickPick(
                [
                    { label: 'dependency',     description: 'runtime dependency' },
                    { label: 'dev-dependency', description: 'development and testing only' },
                ],
                { placeHolder: 'Dependency kind' },
            );
            if (!kind) return;

            runFly(['add', name, '--git', gitUrl, `--${refType}`, refValue,
                    ...(kind.label === 'dev-dependency' ? ['--dev'] : [])]);
        }),
    );

    // ── Status bar (shows active fly version, click to change) ────────────
    createStatusBar(context);

    // ── LSP client (hover on symbols, go-to-definition, find references) ──
    startLspClient(context);

    // ── Document outline (OUTLINE panel + breadcrumbs) ────────────────────
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            FLY_SELECTOR,
            new FlyDocumentSymbolProvider(),
        ),
    );

    // ── Hover documentation for keywords and built-in types ───────────────
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            FLY_SELECTOR,
            new FlyHoverProvider(),
        ),
    );

    // ── Stdlib completion (triggers on '.' and after 'import'/'new') ──────
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            FLY_SELECTOR,
            new FlyCompletionProvider(context.extensionPath),
            '.',   // trigger on dot
        ),
    );

    // ── Live diagnostics via compiler JSON output ─────────────────────────
    //
    // FALLBACK ONLY: when the language server is enabled it is the single
    // source of diagnostics (it compiles the project and publishes per file),
    // and running the compiler here too would duplicate every squiggle and
    // double the work. Same policy as vscode-go, which disables its legacy
    // buildOnSave/vetOnSave diagnostics while gopls is active.
    const lspActive = vscode.workspace.getConfiguration('fly').get<boolean>('enableLsp', true);
    if (!lspActive) {
    const diagCollection = vscode.languages.createDiagnosticCollection('fly');
    context.subscriptions.push(diagCollection);

    const diagProvider = new FlyDiagnosticsProvider(diagCollection);

    // Run on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (vscode.languages.match(FLY_SELECTOR, doc)) {
                diagProvider.schedule(doc);
            }
        }),
    );

    // Run when opening a .fly file
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (vscode.languages.match(FLY_SELECTOR, doc)) {
                diagProvider.schedule(doc);
            }
        }),
    );

    // Clear diagnostics when closing
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (vscode.languages.match(FLY_SELECTOR, doc)) {
                diagProvider.clear(doc.uri);
            }
        }),
    );

    // Run for any already-open .fly documents
    for (const doc of vscode.workspace.textDocuments) {
        if (vscode.languages.match(FLY_SELECTOR, doc)) {
            diagProvider.schedule(doc);
        }
    }

    // ── Workspace-wide diagnostics ─────────────────────────────────────────
    // Scan all .fly files at startup so the Problems panel reflects the full
    // project, not just files the user has explicitly opened.
    const runWorkspaceScan = async (): Promise<void> => {
        const cfg = vscode.workspace.getConfiguration('fly');
        if (!cfg.get<boolean>('enableWorkspaceDiagnostics', true)) return;
        const uris = await vscode.workspace.findFiles('**/*.fly', '**/node_modules/**');
        const openPaths = new Set(
            vscode.workspace.textDocuments.map(d => d.uri.fsPath)
        );
        for (const uri of uris) {
            if (!openPaths.has(uri.fsPath)) {
                diagProvider.runForPath(uri.fsPath);
            }
        }
    };
    void runWorkspaceScan();

    // Re-run diagnostics when new .fly files appear in the workspace.
    const flyWatcher = vscode.workspace.createFileSystemWatcher('**/*.fly');
    context.subscriptions.push(flyWatcher);
    context.subscriptions.push(
        flyWatcher.onDidCreate(uri => diagProvider.runForPath(uri.fsPath)),
    );
    }   // end of the !lspActive fallback diagnostics

    // ── Debug adapter: lldb-dap bundled with the Fly toolchain ────────────
    // The toolchain ships lldb-dap next to fly in bin/, so the adapter is
    // always the one matching the installed compiler — no third-party
    // debugger extension needed.
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('fly', {
            createDebugAdapterDescriptor(): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
                const compiler = vscode.workspace.getConfiguration('fly')
                    .get<string>('compilerPath', 'fly');
                const dap = deriveDapPath(compiler);
                if (path.dirname(dap) !== '.' && !fs.existsSync(dap)) {
                    void vscode.window.showErrorMessage(
                        `Fly: lldb-dap not found at "${dap}". It ships with the Fly ` +
                        `toolchain (bin/lldb-dap) — check fly.compilerPath, or run ` +
                        `"Fly: Select Compiler".`,
                    );
                    return undefined;
                }
                return new vscode.DebugAdapterExecutable(dap, []);
            },
        }),
    );

    // ── Debug command (compile with --debug, launch via lldb-dap) ─────────
    context.subscriptions.push(
        vscode.commands.registerCommand('fly.debugFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'fly') {
                vscode.window.showWarningMessage('Fly: Open a .fly file to debug.');
                return;
            }
            await editor.document.save();

            const cfg        = vscode.workspace.getConfiguration('fly');
            const compiler   = cfg.get<string>('compilerPath', 'fly');
            const debugArgs  = cfg.get<string>('debugBuildArgs', '--debug').trim();
            const filePath   = editor.document.uri.fsPath;
            const baseName   = path.basename(filePath, '.fly');
            const outPath    = path.join(os.tmpdir(), baseName);

            // Compile first; on success launch the debugger.
            try {
                require('child_process').execFileSync(
                    compiler,
                    [...singleFileArgs(filePath),
                     ...debugArgs.split(/\s+/).filter(Boolean), '-o', outPath],
                    { stdio: 'inherit' },
                );
            } catch {
                vscode.window.showErrorMessage(
                    `Fly: Compilation failed. Check the terminal for errors.`
                );
                return;
            }

            await vscode.debug.startDebugging(undefined, {
                type:    'fly',
                request: 'launch',
                name:    'Fly Debug',
                program: outPath,
                args:    [],
                cwd:     path.dirname(filePath),
            });
        }),
    );
}

export async function deactivate(): Promise<void> {
    await stopLspClient();
}
