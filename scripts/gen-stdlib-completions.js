#!/usr/bin/env node
/**
 * Regenerates data/stdlib-completions.json from an INSTALLED Fly toolchain.
 *
 * Usage:  node scripts/gen-stdlib-completions.js [path-to-fly-binary]
 *
 * The toolchain is located exactly like the extension locates it: the argument,
 * else $FLY, else the fly.compilerPath setting, else `fly` on PATH. From the
 * binary it derives <install>/lib and reads the shipped `*.fly.h` headers —
 * the public API the compiler links user code against — extracting per
 * namespace:
 *   - public top-level functions (name, return type, params, signature)
 *   - public classes with their public methods
 *   - public structs with their fields
 *
 * Reading the toolchain rather than a source checkout keeps the completions
 * tied to the compiler the user actually builds with, and leaves no checkout
 * path to go stale when the next release branch lands.
 *
 * Output is deterministic: namespaces sorted, declarations in source order, so
 * re-running against the same toolchain yields an identical file.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const extRoot = path.resolve(__dirname, '..');

// vsCodeSettingsPath — the user settings.json of the VS Code installation, where
// fly.compilerPath lives.
function vsCodeSettingsPath() {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
                         'Code', 'User', 'settings.json');
    }
    if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
    }
    return path.join(home, '.config', 'Code', 'User', 'settings.json');
}

// compilerPathFromSettings — fly.compilerPath as the user configured it, or null.
// Read with a regex rather than JSON.parse: settings.json is JSONC (comments and
// trailing commas are legal there) and one setting is all this needs.
function compilerPathFromSettings() {
    try {
        const raw = fs.readFileSync(vsCodeSettingsPath(), 'utf8');
        const m = raw.match(/"fly\.compilerPath"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (!m) return null;
        return JSON.parse(`"${m[1]}"`);      // undo the JSON string escaping
    } catch {
        return null;
    }
}

// The toolchain to describe. Precedence: explicit argument, then $FLY, then the
// extension's own fly.compilerPath setting, then PATH. Never a source checkout:
// the completions describe the toolchain the user actually compiles with, and
// its layout (<install>/bin/fly + <install>/lib) is the one the compiler itself
// resolves at run time.
const flyExe = process.argv[2] || process.env.FLY || compilerPathFromSettings() || 'fly';
const binDir = path.dirname(path.resolve(flyExe));
const libDir = path.join(path.dirname(binDir), 'lib');
const outFile = path.join(extRoot, 'data', 'stdlib-completions.json');

if (!fs.existsSync(libDir)) {
    console.error(`error: no lib/ directory next to the compiler "${flyExe}" (looked in `
                + `"${libDir}").\nPass the fly binary as an argument, set $FLY, or configure `
                + `fly.compilerPath in VS Code.`);
    process.exit(1);
}

// ── source collection ────────────────────────────────────────────────────────
//
// The shipped `.fly.h` headers ARE the public API: the compiler generates one
// per module and links user code against exactly these declarations, so they
// cannot drift from the toolchain the way a source checkout can.

const files = fs.readdirSync(libDir)
    .filter(n => n.endsWith('.fly.h'))
    .sort()
    .map(n => path.join(libDir, n));

if (files.length === 0) {
    console.error(`error: no *.fly.h headers in "${libDir}".`);
    process.exit(1);
}
console.log(`reading ${files.length} headers from ${libDir}`);

// ── comment / string stripping ───────────────────────────────────────────────
// Produces a structurally equivalent text where comments are blanked and
// string/char literal contents are blanked (delimiters kept), so that brace
// counting and declaration regexes never trip on braces inside literals.
// Fly literals keep escapes raw, but a backslash still shields the closing
// delimiter, so `\"` must not end a string here either.

function stripNoise(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let mode = 'code'; // code | line | block | str | chr
    let delim = '';
    while (i < n) {
        const c = src[i];
        const c2 = i + 1 < n ? src[i + 1] : '';
        if (mode === 'code') {
            if (c === '/' && c2 === '/') { mode = 'line'; out += '  '; i += 2; continue; }
            if (c === '/' && c2 === '*') { mode = 'block'; out += '  '; i += 2; continue; }
            if (c === '"') { mode = 'str'; delim = '"'; out += c; i++; continue; }
            if (c === "'") { mode = 'chr'; delim = "'"; out += c; i++; continue; }
            out += c; i++; continue;
        }
        if (mode === 'line') {
            if (c === '\n') { mode = 'code'; out += c; } else { out += ' '; }
            i++; continue;
        }
        if (mode === 'block') {
            if (c === '*' && c2 === '/') { mode = 'code'; out += '  '; i += 2; continue; }
            out += c === '\n' ? c : ' ';
            i++; continue;
        }
        // str / chr
        if (c === '\\') { out += '  '; i += 2; continue; }
        if (c === delim) { mode = 'code'; out += c; i++; continue; }
        out += c === '\n' ? c : ' ';
        i++; continue;
    }
    return out;
}

// ── logical lines ────────────────────────────────────────────────────────────
// Joins physical lines whose parentheses are unbalanced so that a declaration
// header split across lines is matched as one line.

function logicalLines(text) {
    const phys = text.split('\n');
    const out = [];
    let buf = '';
    let depth = 0;
    for (const line of phys) {
        buf = buf ? buf + ' ' + line.trim() : line;
        for (const ch of line) {
            if (ch === '(') depth++;
            else if (ch === ')') depth = Math.max(0, depth - 1);
        }
        if (depth === 0) { out.push(buf); buf = ''; }
    }
    if (buf) out.push(buf);
    return out;
}

// ── declaration regexes ──────────────────────────────────────────────────────

// public [ret[,ret…]] name[<T>] ( params ) {     — function or method header
// Trailing `{` OPTIONAL: a header declares free functions with no body at all
// (`public int len(const string src)`), while class members inside it still
// carry one (`public void close() {}`).
const FN_RE = /^\s*public\s+(?:((?:[\w.]+(?:<[^>()]*>)?(?:\[\])?)(?:\s*,\s*[\w.]+(?:<[^>()]*>)?(?:\[\])?)*)\s+)?([A-Za-z_]\w*)\s*(?:<[^>()]*>)?\s*\(([^)]*)\)\s*\{?\s*$/;
const CLASS_RE = /^\s*public\s+(class|struct|interface)\s+([A-Za-z_]\w*)/;
const NS_RE = /^\s*namespace\s+([\w.]+)/;
// struct field:  [public] type name [= …]   (no parens on the line)
const FIELD_RE = /^\s*(?:public\s+)?(?!static\b)([A-Za-z_][\w.]*(?:<[^>()]*>)?(?:\[\])?)\s+([A-Za-z_]\w*)\s*(=.*)?$/;

const KEYWORD_HEADS = new Set([
    'if', 'elsif', 'else', 'while', 'for', 'switch', 'return', 'fail',
    'handle', 'test', 'case', 'break', 'continue', 'new', 'import', 'namespace',
]);

function cleanParams(params) {
    return params.trim().replace(/\s+/g, ' ');
}

// ── per-file extraction ──────────────────────────────────────────────────────

const db = {};

function nsEntry(ns) {
    if (!db[ns]) db[ns] = { functions: [], classes: [], structs: [] };
    return db[ns];
}

for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const text = stripNoise(raw);
    const lines = logicalLines(text);

    let ns = '';
    let depth = 0;
    // Current public container (class/struct) while depth is inside it.
    let container = null;      // { kind, name, entry }
    let containerDepth = 0;

    for (const line of lines) {
        const nsm = line.match(NS_RE);
        if (nsm && !ns) {
            // fly.llvm and fly.runtime are compiler intrinsics with special
            // lowering; project convention never calls them from user code, so
            // completing them would only invite mistakes.
            if (nsm[1] === 'fly.llvm' || nsm[1] === 'fly.runtime') break;
            ns = nsm[1];
            continue;
        }

        if (ns) {
            if (depth === 0) {
                const cm = line.match(CLASS_RE);
                if (cm) {
                    const kind = cm[1];
                    const name = cm[2];
                    if (kind === 'struct') {
                        container = { kind, name, entry: { name, fields: [] } };
                        nsEntry(ns).structs.push(container.entry);
                    } else {
                        container = { kind, name, entry: { name, methods: [] } };
                        nsEntry(ns).classes.push(container.entry);
                    }
                    containerDepth = 0; // set after brace counting below
                } else {
                    const fm = line.match(FN_RE);
                    if (fm && !KEYWORD_HEADS.has(fm[2])) {
                        const retType = fm[1] ? fm[1].trim() : 'void';
                        const name = fm[2];
                        const params = cleanParams(fm[3]);
                        nsEntry(ns).functions.push({
                            name, returnType: retType, params,
                            signature: `${name}(${params})`,
                        });
                    }
                }
            } else if (container && depth === containerDepth) {
                if (container.kind === 'struct') {
                    if (!line.includes('(')) {
                        const fdm = line.match(FIELD_RE);
                        if (fdm && !KEYWORD_HEADS.has(fdm[1])) {
                            container.entry.fields.push({ type: fdm[1], name: fdm[2] });
                        }
                    } else {
                        const mm = line.match(FN_RE);
                        if (mm && !KEYWORD_HEADS.has(mm[2])) {
                            // struct constructors/methods are rare; ignore for fields-only schema
                        }
                    }
                } else {
                    const mm = line.match(FN_RE);
                    if (mm && !KEYWORD_HEADS.has(mm[2])) {
                        container.entry.methods.push({ name: mm[2], params: cleanParams(mm[3]) });
                    }
                }
            }
        }

        // Brace tracking (after matching, so a header line's own '{' moves us
        // into the body for the following lines).
        const prevDepth = depth;
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        depth = Math.max(0, depth);
        if (container && containerDepth === 0 && depth > prevDepth) {
            containerDepth = depth; // body depth of the container just opened
        }
        if (container && containerDepth > 0 && depth < containerDepth) {
            container = null;
            containerDepth = 0;
        }
    }
}

// ── deterministic output ─────────────────────────────────────────────────────

const sorted = {};
for (const ns of Object.keys(db).sort()) sorted[ns] = db[ns];

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(sorted, null, 2) + '\n');

const nsCount = Object.keys(sorted).length;
const fnCount = Object.values(sorted).reduce((a, e) => a + e.functions.length, 0);
const clCount = Object.values(sorted).reduce((a, e) => a + e.classes.length, 0);
const stCount = Object.values(sorted).reduce((a, e) => a + e.structs.length, 0);
console.log(`wrote ${path.relative(extRoot, outFile)}: ${nsCount} namespaces, ` +
            `${fnCount} functions, ${clCount} classes, ${stCount} structs`);
