import sqlite3WasmFunctionAdapterUrl from "~/external/sqlite/ext/wasm/jswasm/sqlite3-function-adapter.wasm?url";
import sqlite3WasmUrl from "~/external/sqlite/ext/wasm/jswasm/sqlite3.wasm?url";

import {createSqlite3WasmFunctionAdapter} from "~/shared/databases/create_sqlite3_wasm_function_adapter.js";
import {registerSqlite3Wasm} from "~/shared/databases/sqlite.js";

registerSqlite3Wasm({
    instantiateWasm: (imports, onSuccess) => {
        // eslint-disable-next-line cyberworlds/no-global-fetch
        void WebAssembly.instantiateStreaming(fetch(sqlite3WasmUrl), imports).then(
            ({instance, module}) => onSuccess(instance, module),
        );
    },
    // eslint-disable-next-line cyberworlds/no-global-fetch
    functionAdapter: WebAssembly.compileStreaming(fetch(sqlite3WasmFunctionAdapterUrl)).then(
        createSqlite3WasmFunctionAdapter,
    ),
});
