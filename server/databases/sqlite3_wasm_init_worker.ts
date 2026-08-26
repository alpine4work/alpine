// Side-effect import: registers the sqlite3 WASM loader for Cloudflare Workers and
// Miniflare environments.

import sqlite3WasmFunctionAdapterModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3-function-adapter.wasm";
import sqlite3WasmModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.wasm";

import {createSqlite3WasmFunctionAdapter} from "~/shared/databases/create_sqlite3_wasm_function_adapter.js";
import {registerSqlite3Wasm} from "~/shared/databases/sqlite.js";

registerSqlite3Wasm({
    instantiateWasm: (imports, onSuccess) => {
        void WebAssembly.instantiate(sqlite3WasmModule, imports).then(instance =>
            onSuccess(instance, sqlite3WasmModule),
        );
    },
    functionAdapter: createSqlite3WasmFunctionAdapter(sqlite3WasmFunctionAdapterModule),
});
