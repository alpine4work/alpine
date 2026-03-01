import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";

// SQLite WASM uses `fetch()` to load the `.wasm` file. In our Jest
// environment `fetch` is not available and even Node.js `fetch`
// doesn't support `file://` URLs. Provide a minimal polyfill that
// reads the file from disk.
globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as URL).href;
    const filePath = url.startsWith("file://")
        ? fileURLToPath(url)
        : url;
    const buffer = readFileSync(filePath);
    return {
        ok: true,
        arrayBuffer: async () =>
            buffer.buffer.slice(
                buffer.byteOffset,
                buffer.byteOffset + buffer.byteLength,
            ),
    };
}) as typeof fetch;

// Force the `WebAssembly.instantiate(bytes)` fallback path since
// `WebAssembly.instantiateStreaming` expects a real `Response` object.
delete (WebAssembly as unknown as Record<string, unknown>).instantiateStreaming;

test("sqlite works", async () => {
    const sqlite3 = await sqlite3InitModule();

    const db = new sqlite3.oo1.DB("/mydb.sqlite3", "ct");

    expect(db.selectArray("SELECT 1 + 1")).toEqual([2]);
});
