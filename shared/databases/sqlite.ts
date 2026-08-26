import sqlite3InitModule, {
    type Sqlite3Static,
    type WASM_API,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export type {Database as SqliteDatabase} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";

export type Sqlite3WasmFunctionAdapter = WASM_API["jsFuncToWasm"];

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

let wasmConfiguration:
    | {
          instantiateWasm: Sqlite3InstantiateWasm;
          functionAdapter: Sqlite3WasmFunctionAdapter | Promise<Sqlite3WasmFunctionAdapter>;
      }
    | undefined;
let sqlite3Promise: Promise<Sqlite3Static> | undefined;

/**
 * Register the platform-specific SQLite WASM modules. Called once from a
 * side-effect import at the service entry point.
 */
export function registerSqlite3Wasm(configuration: {
    instantiateWasm: Sqlite3InstantiateWasm;
    functionAdapter: Sqlite3WasmFunctionAdapter | Promise<Sqlite3WasmFunctionAdapter>;
}): void {
    assert(
        wasmConfiguration === undefined,
        "sqlite3 WASM modules already registered. registerSqlite3Wasm must only be called once.",
    );
    assert(
        sqlite3Promise === undefined,
        "sqlite3 WASM modules must be registered before SQLite is loaded.",
    );
    wasmConfiguration = configuration;
}

/** Load the shared SQLite module for the current platform. */
export function loadSqlite3(): Promise<Sqlite3Static> {
    if (sqlite3Promise === undefined) {
        sqlite3Promise = initializeSqlite3();
    }
    return sqlite3Promise;
}

async function initializeSqlite3(): Promise<Sqlite3Static> {
    if (wasmConfiguration === undefined) {
        return await sqlite3InitModule();
    }
    const jsFuncToWasm = await wasmConfiguration.functionAdapter;
    return await sqlite3InitModule({
        instantiateWasm: wasmConfiguration.instantiateWasm,
        jsFuncToWasm,
    });
}
