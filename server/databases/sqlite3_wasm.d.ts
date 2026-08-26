declare module "~/external/sqlite/ext/wasm/jswasm/sqlite3.wasm" {
    const sqlite3WasmModule: WebAssembly.Module;
    // Cloudflare compiled WASM modules are exposed through a default export.
    // eslint-disable-next-line import/no-default-export
    export default sqlite3WasmModule;
}

declare module "~/external/sqlite/ext/wasm/jswasm/sqlite3-function-adapter.wasm" {
    const sqlite3WasmFunctionAdapterModule: WebAssembly.Module;
    // Cloudflare compiled WASM modules are exposed through a default export.
    // eslint-disable-next-line import/no-default-export
    export default sqlite3WasmFunctionAdapterModule;
}
