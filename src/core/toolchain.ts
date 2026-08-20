/**
 * Pure toolchain-path helpers — NO vscode import, NO ambient state beyond the
 * injected platform flag, so plain node can unit-test them (tests/unit.js).
 */
import * as path from 'path';
import * as os from 'os';

/**
 * Path of a tool shipped next to the fly binary (fly-lsp, lldb-dap, …).
 * A bare compilerPath ("fly") yields the bare tool name, which resolves
 * through PATH like the compiler itself.
 */
export function deriveSiblingTool(
    flyPath: string,
    tool: string,
    isWindows: boolean = os.platform() === 'win32',
): string {
    // The path flavor follows the TARGET platform, not the host, so the
    // function is deterministic everywhere (and unit-testable on any CI).
    const p    = isWindows ? path.win32 : path.posix;
    const dir  = p.dirname(flyPath);
    const name = isWindows ? `${tool}.exe` : tool;
    return dir === '.' ? name : p.join(dir, name);
}

/**
 * The driver takes no positional file arguments: it compiles a source
 * directory. A single file builds via --entry <file> (discovery is skipped)
 * with its directory as the import root.
 */
export function singleFileArgs(filePath: string): string[] {
    return ['--entry', filePath, '--src-dir', path.dirname(filePath)];
}
