import actuallyCreateDebug from "debug";
import {basename, relative as relativePath, resolve as resolvePath} from "path";
import {assert} from "~/shared/helpers/control/assert.js";

const ourImportMetaUrl = import.meta.url;
assert(ourImportMetaUrl.startsWith("file://"));

const ourImportPath = ourImportMetaUrl.slice(7);
const rootPath = resolvePath(ourImportPath, "../../..");

/**
 * Creates a `debug` function using the [debug][1] npm package. We like to use
 * the file name as the debug namespace. You should always call this with:
 *
 * ```
 * const debug = createDebug(import.meta.url);
 * ```
 *
 * [1]: https://www.npmjs.com/package/debug
 */
export function createDebug(importMetaUrl: string) {
    assert(importMetaUrl.startsWith("file://"));

    const importPath = importMetaUrl.slice(7);

    const namespace = relativePath(rootPath, importPath);

    const debug = actuallyCreateDebug(namespace);

    // Select the `debug` color based on the base file name so if the file moves
    // the color stays the same.
    debug.color = actuallyCreateDebug.selectColor(basename(importPath)) as any;

    return debug;
}
