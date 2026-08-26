import type {Sqlite3WasmFunctionAdapter} from "~/shared/databases/sqlite.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

type Sqlite3WasmCallback = (...args: Array<number | bigint>) => number | bigint | undefined;

/**
 * Creates typed SQLite function-table entries without compiling WASM at runtime.
 * The supplied module imports and re-exports one callback for each supported
 * signature. Cloudflare compiles the module during deployment.
 */
export function createSqlite3WasmFunctionAdapter(
    module: WebAssembly.Module,
): Sqlite3WasmFunctionAdapter {
    const imports = WebAssembly.Module.imports(module);
    const exportNames = new Set(
        WebAssembly.Module.exports(module)
            .filter(moduleExport => moduleExport.kind === "function")
            .map(moduleExport => moduleExport.name),
    );

    assert(imports.length > 0, "sqlite3 WASM function adapter module has no imports");
    for (const moduleImport of imports) {
        assert(
            moduleImport.module === "callbacks" && moduleImport.kind === "function",
            `unexpected sqlite3 WASM function adapter import: ${moduleImport.module}.${moduleImport.name}`,
        );
    }

    return ((
        first: Sqlite3WasmCallback | string,
        second: Sqlite3WasmCallback | string,
    ): Sqlite3WasmCallback => {
        const func = typeof first === "string" ? second : first;
        const signature = typeof first === "string" ? first : second;
        assert(typeof func === "function", "sqlite3 WASM function adapter requires a function");
        assert(typeof signature === "string", "sqlite3 WASM function adapter requires a signature");

        const exportName = sqlite3WasmFunctionAdapterExportName(signature);
        assert(
            exportNames.has(exportName),
            `unsupported sqlite3 WASM function adapter signature: ${signature}`,
        );

        const callbacks = Object.fromEntries(
            imports.map(moduleImport => [moduleImport.name, func]),
        );
        const instance = new WebAssembly.Instance(module, {callbacks});
        const adaptedFunction = instance.exports[exportName];
        assert(
            typeof adaptedFunction === "function",
            `sqlite3 WASM function adapter export is not a function: ${exportName}`,
        );
        return adaptedFunction as Sqlite3WasmCallback;
    }) as Sqlite3WasmFunctionAdapter;
}

function sqlite3WasmFunctionAdapterExportName(signature: string): string {
    const match = /^([visPpjfd])(?:\(([visPpjfd]*)\)|([visPpjfd]*))$/.exec(signature);
    assert(match !== null, `invalid sqlite3 WASM function adapter signature: ${signature}`);

    const result = normalizeSqlite3WasmFunctionAdapterType(match[1]!);
    const parameters = (match[2] ?? match[3] ?? "")
        .split("")
        .map(normalizeSqlite3WasmFunctionAdapterType)
        .join("");
    return `${result}_${parameters}`;
}

function normalizeSqlite3WasmFunctionAdapterType(type: string): string {
    switch (type) {
        case "p":
        case "P":
        case "s":
            return "i";
        case "v":
        case "i":
        case "j":
        case "f":
        case "d":
            return type;
        default:
            throw new InternalError(`invalid sqlite3 WASM function adapter type: ${type}`);
    }
}
