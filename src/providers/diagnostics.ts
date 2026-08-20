import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface FlyDiagnosticEntry {
    level: string;
    file: string;
    line: number;
    column: number;
    message: string;
}

interface FlyJsonOutput {
    diagnostics: FlyDiagnosticEntry[];
}

// Pure JSON-repair and file-mapping logic lives in core/diagjson
// (unit-tested without vscode).
import { sanitizeCompilerJson, resolveDiagFile } from '../core/diagjson';

function levelToSeverity(level: string): vscode.DiagnosticSeverity {
    switch (level) {
        case 'error':
        case 'fatal error': return vscode.DiagnosticSeverity.Error;
        case 'warning':     return vscode.DiagnosticSeverity.Warning;
        case 'note':
        case 'remark':      return vscode.DiagnosticSeverity.Information;
        default:            return vscode.DiagnosticSeverity.Hint;
    }
}

export class FlyDiagnosticsProvider {
    private collection: vscode.DiagnosticCollection;
    private pending: NodeJS.Timeout | undefined;

    constructor(collection: vscode.DiagnosticCollection) {
        this.collection = collection;
    }

    /** Schedule a diagnostic run (debounced 800 ms). */
    schedule(document: vscode.TextDocument): void {
        if (this.pending) clearTimeout(this.pending);
        this.pending = setTimeout(() => this.run(document), 800);
    }

    clear(uri: vscode.Uri): void {
        this.collection.delete(uri);
    }

    /** Run diagnostics on a file path without requiring an open TextDocument. */
    runForPath(filePath: string): void {
        const config = vscode.workspace.getConfiguration('fly');
        if (!config.get<boolean>('enableDiagnostics', true)) return;
        this.runCompiler(filePath, vscode.Uri.file(filePath));
    }

    private run(document: vscode.TextDocument): void {
        const config = vscode.workspace.getConfiguration('fly');
        if (!config.get<boolean>('enableDiagnostics', true)) return;

        const filePath = document.uri.fsPath;
        this.runCompiler(filePath, document.uri);
    }

    private runCompiler(filePath: string, primaryUri: vscode.Uri): void {
        const config = vscode.workspace.getConfiguration('fly');
        const compilerPath = config.get<string>('compilerPath', 'fly');
        const tmpFile = path.join(os.tmpdir(), `fly-diag-${Date.now()}.json`);

        // No positional files: the driver compiles a directory. --entry skips
        // discovery and names this file; its directory resolves the imports.
        const args = [
            '--entry',      filePath,
            '--src-dir',    path.dirname(filePath),
            '--no-output',
            '--log-format', 'json',
            '--log-file',   tmpFile,
        ];

        const proc = cp.spawn(compilerPath, args, { timeout: 10_000 });

        proc.on('close', () => {
            try {
                if (!fs.existsSync(tmpFile)) return;
                const raw = fs.readFileSync(tmpFile, 'utf8');
                fs.unlinkSync(tmpFile);

                const parsed = JSON.parse(sanitizeCompilerJson(raw)) as FlyJsonOutput;
                const byFile = new Map<string, vscode.Diagnostic[]>();

                for (const d of parsed.diagnostics ?? []) {
                    const severity = levelToSeverity(d.level);
                    // line and column in the JSON are 1-based
                    const line = Math.max(0, (d.line ?? 1) - 1);
                    const col  = Math.max(0, (d.column ?? 1) - 1);
                    const range = new vscode.Range(line, col, line, col + 1);
                    const diag = new vscode.Diagnostic(range, d.message, severity);
                    diag.source = 'fly';

                    const key = resolveDiagFile(d.file, filePath, fs.existsSync);
                    if (!byFile.has(key)) byFile.set(key, []);
                    byFile.get(key)!.push(diag);
                }

                // Clear current file first, then set diagnostics per file
                this.collection.delete(primaryUri);
                for (const [file, diags] of byFile) {
                    this.collection.set(vscode.Uri.file(file), diags);
                }
            } catch {
                // Silently ignore parse/IO errors
            }
        });

        proc.on('error', () => {
            // Compiler not found or failed to spawn — suppress silently
        });
    }
}
