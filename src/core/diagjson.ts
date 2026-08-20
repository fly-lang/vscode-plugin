/**
 * Pure helpers for the compiler's --log-format json output — NO vscode import,
 * so plain node can unit-test them (tests/unit.js).
 */

/**
 * Repair the JSON log of compilers up to 0.14.4, which did not JSON-escape the
 * per-diagnostic "file" paths: Windows backslashes produce broken escapes
 * (\U, \b, …). The compiler's own escaping emits ONLY \\ and \" — keep those
 * atomic and double every other backslash (a raw path separator). Idempotent
 * on fixed (correctly escaped) output.
 */
export function sanitizeCompilerJson(raw: string): string {
    return raw.replace(/\\\\|\\"|\\/g, m => (m === '\\' ? '\\\\' : m));
}

/**
 * Compilers up to 0.14.4 report the module path WITHOUT the .fly extension
 * (e.g. `C:\proj\broken` for `broken.fly`); newer ones report the real path.
 * Restore it so diagnostics attach to the open document either way.
 * `exists` is injected so tests need no filesystem.
 */
export function resolveDiagFile(
    reported: string | undefined,
    compiledFile: string,
    exists: (p: string) => boolean,
): string {
    if (!reported) return compiledFile;
    if (exists(reported)) return reported;
    const withExt = reported + '.fly';
    if (exists(withExt)) return withExt;
    return compiledFile;
}
