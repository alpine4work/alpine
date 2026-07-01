// Side-effect import: registers the sqlite3 WASM loader for Cloudflare Workers and
// Miniflare environments.
//
// The host pre-compiles the WASM binary and injects it as a global. In Miniflare
// dev, edge_service_dev_main.mjs does this via WebAssembly.compile() + globals
// injection.
//
// TODO: Replace the global with `import wasmModule from './sqlite3.wasm'` once
// esbuild/Bazel plumbing supports .wasm imports in the bundle.

import {registerSqlite3WasmLoader} from "~/shared/databases/sqlite.js";
import {assert} from "~/shared/helpers/control/assert.js";

const wasmModule = (globalThis as any).__sqlite3WasmModule as WebAssembly.Module | undefined;

assert(
    wasmModule !== undefined,
    "sqlite3 WASM module not found on globalThis.__sqlite3WasmModule. " +
        "The host must pre-compile and inject the module.",
);

registerSqlite3WasmLoader((imports, onSuccess) => {
    WebAssembly.instantiate(wasmModule, imports).then(instance => onSuccess(instance, wasmModule));
});
