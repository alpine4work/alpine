// Side-effect import: registers the sqlite3 WASM loader for Cloudflare Workers and
// Miniflare environments.

import sqlite3WasmModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.wasm";

import {registerSqlite3WasmLoader} from "~/shared/databases/sqlite.js";

registerSqlite3WasmLoader((imports, onSuccess) => {
    WebAssembly.instantiate(sqlite3WasmModule, imports).then(instance =>
        onSuccess(instance, sqlite3WasmModule),
    );
});
