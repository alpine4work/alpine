import {readFileSync} from "node:fs";
import {join as joinPath} from "node:path";
import {createSqlite3WasmFunctionAdapter} from "~/shared/databases/create_sqlite3_wasm_function_adapter.js";
import {Database} from "~/shared/databases/database.js";
import {registerSqlite3WasmForTest} from "~/shared/databases/test_helpers/register_sqlite3_wasm_for_test.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

const adapterModule = new WebAssembly.Module(
    Uint8Array.from(
        readFileSync(
            joinPath(
                assertExists(process.env.RUNFILES_DIR),
                "sqlite/ext/wasm/jswasm/sqlite3-function-adapter.wasm",
            ),
        ),
    ),
);

describe("createSqlite3WasmFunctionAdapter", () => {
    test("creates a typed WASM function for a JavaScript callback", () => {
        // Arrange
        const adapter = createSqlite3WasmFunctionAdapter(adapterModule);

        // Act
        const increment = adapter((value: number) => value + 1, "i(i)");

        // Assert
        expect(increment(41)).toBe(42);
    });

    test("supports Emscripten signatures and pointer aliases", () => {
        // Arrange
        const adapter = createSqlite3WasmFunctionAdapter(adapterModule);

        // Act
        const add = adapter("ipp", (first: number, second: number) => first + second);

        // Assert
        expect(add(20, 22)).toBe(42);
    });

    test("supports all callbacks installed during database creation", async () => {
        // Arrange
        registerSqlite3WasmForTest();

        // Act
        const database = await Database.create({
            readPage: () => null,
            getFileSize: () => 0,
        });

        // Assert
        expect(database).toBeInstanceOf(Database);
        database.close();
    });

    test("rejects a callback signature that was not precompiled", () => {
        // Arrange
        const adapter = createSqlite3WasmFunctionAdapter(adapterModule);

        // Act and assert
        expect(() => adapter(() => undefined, "v(ii)")).toThrow(
            "unsupported sqlite3 WASM function adapter signature: v(ii)",
        );
    });
});
