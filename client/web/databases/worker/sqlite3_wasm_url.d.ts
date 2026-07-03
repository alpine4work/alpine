declare module "~/external/sqlite/ext/wasm/jswasm/sqlite3.wasm?url" {
    const url: string;
    // Vite asset URL imports expose the resolved URL as a default export.
    // eslint-disable-next-line import/no-default-export
    export default url;
}
