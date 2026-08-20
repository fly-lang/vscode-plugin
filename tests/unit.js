// Unit tests for the pure core modules (out/core/*, compiled by `npm run
// compile`). Plain node + assert: no framework, no vscode — the same reason
// the logic lives in src/core in the first place.
//
//   npm test        (compile + run; wired into CI before packaging)
'use strict';
const assert = require('assert');
const path = require('path');

const { deriveSiblingTool, singleFileArgs } = require('../out/core/toolchain');
const { sanitizeCompilerJson, resolveDiagFile } = require('../out/core/diagjson');

let n = 0;
function t(name, fn) { fn(); n++; console.log(`  ok    ${name}`); }

// ── deriveSiblingTool ────────────────────────────────────────────────────────
t('sibling tool next to an absolute fly path (windows)', () => {
    assert.strictEqual(
        deriveSiblingTool('C:\\tc\\bin\\fly.exe', 'fly-lsp', true),
        'C:\\tc\\bin\\fly-lsp.exe');
});
t('sibling tool next to an absolute fly path (posix)', () => {
    assert.strictEqual(deriveSiblingTool('/tc/bin/fly', 'lldb-dap', false),
        '/tc/bin/lldb-dap');
});
t('bare "fly" resolves the bare tool name through PATH', () => {
    assert.strictEqual(deriveSiblingTool('fly', 'fly-lsp', false), 'fly-lsp');
    assert.strictEqual(deriveSiblingTool('fly', 'fly-lsp', true), 'fly-lsp.exe');
});

// ── singleFileArgs ───────────────────────────────────────────────────────────
t('single file compiles via --entry with its directory as import root', () => {
    const p = path.join('proj', 'src', 'main.fly');
    assert.deepStrictEqual(singleFileArgs(p),
        ['--entry', p, '--src-dir', path.join('proj', 'src')]);
});

// ── sanitizeCompilerJson ─────────────────────────────────────────────────────
t('raw windows path in "file" becomes parseable JSON', () => {
    // The raw string below contains SINGLE backslashes — the exact broken
    // output of compilers up to 0.14.4 (illegal JSON escapes like \U).
    const raw = '{"file":"C:\\Users\\m\\broken","message":"boom"}';
    const p = JSON.parse(sanitizeCompilerJson(raw));
    assert.strictEqual(p.file, 'C:\\Users\\m\\broken');
});
t('backslash-b and backslash-u path segments survive as literal characters', () => {
    // \b would decode as backspace, \U is an illegal escape: both are raw
    // separators in that broken output and must survive as literal text.
    const raw = '{"file":"C:\\build\\unit"}';
    assert.strictEqual(JSON.parse(sanitizeCompilerJson(raw)).file, 'C:\\build\\unit');
});
t('idempotent on correctly escaped output (fixed compilers)', () => {
    const good = '{"file":"C:\\\\tc\\\\a.fly","message":"say \\"hi\\""}';
    assert.strictEqual(sanitizeCompilerJson(good), good);
    const p = JSON.parse(good);
    assert.strictEqual(p.file, 'C:\\tc\\a.fly');
    assert.strictEqual(p.message, 'say "hi"');
});

// ── resolveDiagFile ──────────────────────────────────────────────────────────
t('extensionless module path maps back to the real .fly source', () => {
    const exists = (p) => p === '/proj/broken.fly';
    assert.strictEqual(resolveDiagFile('/proj/broken', '/proj/x.fly', exists),
        '/proj/broken.fly');
});
t('a path that exists as reported is kept (fixed compilers)', () => {
    const exists = (p) => p === '/proj/broken.fly';
    assert.strictEqual(resolveDiagFile('/proj/broken.fly', '/proj/x.fly', exists),
        '/proj/broken.fly');
});
t('unknown or missing file falls back to the compiled file', () => {
    const never = () => false;
    assert.strictEqual(resolveDiagFile('/gone', '/proj/x.fly', never), '/proj/x.fly');
    assert.strictEqual(resolveDiagFile(undefined, '/proj/x.fly', never), '/proj/x.fly');
});

console.log(`${n} tests passed`);
