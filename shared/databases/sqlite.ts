import {assert} from "~/shared/helpers/control/assert.js";

export type {Database as SqliteDatabase} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";

/**
 * Callback that loads and instantiates the sqlite3 WASM binary. Matches the
 * Emscripten `Module.instantiateWasm` signature.
 *
 * Platform-specific init files register an implementation via {@link
 * registerSqlite3WasmLoader} before any sqlite3 code runs.
 */
export type Sqlite3InstantiateWasm = (
    imports: WebAssembly.Imports,
    onSuccess: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
) => void;

let loader: Sqlite3InstantiateWasm | undefined;

/**
 * Register the platform-specific WASM loader. Called once from a side-effect
 * import at the service entry-point.
 */
export function registerSqlite3WasmLoader(fn: Sqlite3InstantiateWasm): void {
    assert(
        loader === undefined,
        "sqlite3 WASM loader already registered. " +
            "registerSqlite3WasmLoader must only be called once.",
    );
    loader = fn;
}

/**
 * Returns the registered loader. Asserts if none was registered.
 */
export function sqlite3WasmLoader(): Sqlite3InstantiateWasm {
    assert(
        loader !== undefined,
        "No sqlite3 WASM loader registered. " +
            "Import a platform-specific init file (e.g. " +
            "sqlite3_wasm_init_worker.ts) before using sqlite3.",
    );
    return loader;
}

/**
 * Returns the registered loader, or `undefined` if none was registered. Use this
 * when falling back to default Emscripten loading is acceptable (e.g. in tests).
 */
export function trySqlite3WasmLoader(): Sqlite3InstantiateWasm | undefined {
    return loader;
}
