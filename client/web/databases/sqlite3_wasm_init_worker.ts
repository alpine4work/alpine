import sqlite3WasmUrl from "~/external/sqlite/ext/wasm/jswasm/sqlite3.wasm?url";

import {registerSqlite3WasmLoader} from "~/shared/databases/sqlite3_wasm_loader.js";

registerSqlite3WasmLoader((imports, onSuccess) => {
    // eslint-disable-next-line cyberworlds/no-global-fetch
    WebAssembly.instantiateStreaming(fetch(sqlite3WasmUrl), imports).then(({instance, module}) =>
        onSuccess(instance, module),
    );
});
