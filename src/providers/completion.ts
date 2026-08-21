import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface StdlibFunction {
    name: string;
    returnType: string;
    params: string;
    signature: string;
}

interface StdlibMethod {
    name: string;
    params: string;
}

interface StdlibClass {
    name: string;
    methods: StdlibMethod[];
}

interface StdlibStruct {
    name: string;
    fields: { type: string; name: string }[];
}

interface NamespaceEntry {
    functions: StdlibFunction[];
    classes: StdlibClass[];
    structs: StdlibStruct[];
}

type StdlibDb = Record<string, NamespaceEntry>;

function loadDb(extensionPath: string): StdlibDb {
    // data/ is included in the packaged .vsix (src/ is not). Regenerate with
    // scripts/gen-stdlib-completions.js against a Fly checkout's std sources.
    const dbPath = path.join(extensionPath, 'data', 'stdlib-completions.json');
    try {
        return JSON.parse(fs.readFileSync(dbPath, 'utf8')) as StdlibDb;
    } catch (e) {
        console.error(`Fly: cannot load stdlib completions from ${dbPath}:`, e);
        void vscode.window.showWarningMessage(
            'Fly: stdlib completion database not found — std completions disabled.');
        return {};
    }
}

function makeDetail(sig: string): string {
    return sig.replace(/^public\s+/, '');
}

export class FlyCompletionProvider implements vscode.CompletionItemProvider {
    private db: StdlibDb;

    constructor(extensionPath: string) {
        this.db = loadDb(extensionPath);
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.CompletionItem[] {
        const linePrefix = document.lineAt(position).text.slice(0, position.character);

        // ── 1. After a namespace prefix: str.  /  fly.str.  /  os.fs.  etc. ──
        const dotMatch = linePrefix.match(/([\w.]+)\.$/);
        if (dotMatch) {
            const prefix = dotMatch[1]; // e.g. "str" or "fly.str" or "os.fs"
            return this.completionsForPrefix(prefix);
        }

        // ── 2. After `import ` — suggest known namespaces ──────────────────
        if (/^\s*import\s+[\w.]*$/.test(linePrefix)) {
            return this.namespaceCompletions();
        }

        // ── 3. After `new ` — suggest class names ───────────────────────────
        if (/\bnew\s+[\w]*$/.test(linePrefix)) {
            return this.classCompletions();
        }

        return [];
    }

    private completionsForPrefix(prefix: string): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // Match both short aliases (str) and fully qualified names (fly.str)
        for (const [ns, data] of Object.entries(this.db)) {
            const shortNs = ns.split('.').pop()!;          // "str" from "fly.str"
            const matches = ns === prefix || shortNs === prefix || ns.endsWith('.' + prefix);
            if (!matches) continue;

            for (const fn of data.functions) {
                const item = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
                item.detail = makeDetail(fn.signature);
                item.documentation = new vscode.MarkdownString(`\`\`\`fly\n${makeDetail(fn.signature)}\n\`\`\``);
                item.insertText = new vscode.SnippetString(this.buildSnippet(fn.name, fn.params));
                items.push(item);
            }

            for (const cls of data.classes) {
                const item = new vscode.CompletionItem(cls.name, vscode.CompletionItemKind.Class);
                item.detail = `class ${cls.name}`;
                items.push(item);
            }

            for (const st of data.structs) {
                const item = new vscode.CompletionItem(st.name, vscode.CompletionItemKind.Struct);
                item.detail = `struct ${st.name}`;
                items.push(item);
            }
        }

        return items;
    }

    private namespaceCompletions(): vscode.CompletionItem[] {
        return Object.keys(this.db).map(ns => {
            const item = new vscode.CompletionItem(ns, vscode.CompletionItemKind.Module);
            item.detail = `namespace ${ns}`;
            return item;
        });
    }

    private classCompletions(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        for (const data of Object.values(this.db)) {
            for (const cls of data.classes) {
                const item = new vscode.CompletionItem(cls.name, vscode.CompletionItemKind.Class);
                item.insertText = new vscode.SnippetString(`${cls.name}()`);
                items.push(item);
            }
        }
        return items;
    }

    // Build a snippet string from a parameter list string, e.g.
    // "const string src, const int start" → "($1src$, $2start$)"
    private buildSnippet(name: string, params: string): string {
        if (!params.trim()) return `${name}()$0`;
        const paramNames = params
            .split(',')
            .map((p, i) => {
                const parts = p.trim().split(/\s+/);
                const pname = parts[parts.length - 1];
                return `\${${i + 1}:${pname}}`;
            })
            .join(', ');
        return `${name}(${paramNames})$0`;
    }
}
