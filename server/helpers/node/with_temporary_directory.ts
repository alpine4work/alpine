import fs from "fs/promises";
import {join as joinPath, sep} from "path";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Create a temporary directory within `parentDirectoryPath`. Once `action`
 * finishes the temporary directory and all of its contents will be deleted.
 *
 * If the Node.js process exits abnormally (e.g. `process.exit()` is called or
 * there's an out-of-memory exception that immediately crashes the process) then
 * the temporary directory won't be cleaned up. It's recommended that
 * `parentDirectoryPath` is within the operating system's temporary directory
 * (`os.tmpdir()`) so it'll be occasionally cleaned by the operating system itself
 * in case we've left some files around in failure scenarios.
 */
export async function withTemporaryDirectory<Value>(
    parentDirectoryPath: string,
    namePrefix: string,
    action: (temporaryDirectoryPath: string) => Promise<Value>,
): Promise<Value> {
    assert(!namePrefix.includes(sep));

    await fs.mkdir(parentDirectoryPath, {recursive: true});

    const temporaryDirectoryPath = await fs.mkdtemp(joinPath(parentDirectoryPath, namePrefix));
    try {
        const value = await action(temporaryDirectoryPath);
        return value;
    } finally {
        await fs.rm(temporaryDirectoryPath, {recursive: true});
    }
}
