import {readFileSync} from "node:fs";
import {join as joinPath} from "node:path";
import {createSqlite3WasmFunctionAdapter} from "~/shared/databases/create_sqlite3_wasm_function_adapter.js";
import {registerSqlite3Wasm} from "~/shared/databases/sqlite.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

/** Register the precompiled SQLite modules for a Node.js test process. */
export function registerSqlite3WasmForTest(): void {
    const runfilesDirectoryPath = assertExists(process.env.RUNFILES_DIR);
    const adapterModule = new WebAssembly.Module(
        Uint8Array.from(
            readFileSync(
                joinPath(
                    runfilesDirectoryPath,
                    "sqlite/ext/wasm/jswasm/sqlite3-function-adapter.wasm",
                ),
            ),
        ),
    );
    const sqlite3Module = new WebAssembly.Module(
        Uint8Array.from(
            readFileSync(joinPath(runfilesDirectoryPath, "sqlite/ext/wasm/jswasm/sqlite3.wasm")),
        ),
    );

    registerSqlite3Wasm({
        instantiateWasm: (imports, onSuccess) => {
            const instance = new WebAssembly.Instance(sqlite3Module, imports);
            onSuccess(instance, sqlite3Module);
        },
        functionAdapter: createSqlite3WasmFunctionAdapter(adapterModule),
    });
}
