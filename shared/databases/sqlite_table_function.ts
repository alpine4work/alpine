import type {
    Database,
    SqlValue,
    Sqlite3Static,
    WasmPointer,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * Registers an eponymous virtual table module that acts as a table-valued
 * function. The function can be called directly in SQL as `FROM name(args)`.
 *
 * Visible columns come first, then hidden argument columns. SQLite passes argument
 * values via `xBestIndex`/`xFilter`.
 */
export function registerSqliteTableFunction(
    sqlite3: Sqlite3Static,
    db: Database,
    name: string,
    options: {
        columns: ReadonlyArray<string>;
        args: ReadonlyArray<string>;
        compute: (...args: Array<SqlValue>) => Array<Array<SqlValue>>;
    },
): void {
    const capi = sqlite3.capi;
    const wasm = sqlite3.wasm;
    const vtab = sqlite3.vtab;

    const allColumns = [...options.columns, ...options.args];
    const columnDefs = allColumns.map((col, i) => {
        const hidden = i >= options.columns.length ? " HIDDEN" : "";
        return `${col}${hidden}`;
    });
    const schemaSql = `CREATE TABLE x(${columnDefs.join(", ")})`;

    const firstArgColumn = options.columns.length;

    // Cursor state: rows + current index, keyed by cursor pointer.
    const cursors = new Map<WasmPointer, {rows: Array<Array<SqlValue>>; index: number}>();

    const mod = (vtab.setupModule as any)({
        catchExceptions: false,
        methods: {
            xCreate(
                _db: WasmPointer,
                _pAux: WasmPointer,
                _argc: number,
                _argv: WasmPointer,
                ppVtab: WasmPointer,
            ) {
                const rc = capi.sqlite3_declare_vtab(assertExists(db.pointer), schemaSql);
                if (rc !== capi.SQLITE_OK) return rc;
                vtab.xVtab.create(ppVtab);
                return capi.SQLITE_OK;
            },

            // Eponymous: xConnect === xCreate.
            xConnect: true,

            xDisconnect(pVtab: WasmPointer) {
                vtab.xVtab.dispose(pVtab);
                return capi.SQLITE_OK;
            },

            // xDestroy === xDisconnect for eponymous.
            xDestroy: true,

            xBestIndex(_pVtab: WasmPointer, pIdxInfo: WasmPointer) {
                const info = vtab.xIndexInfo(pIdxInfo);
                try {
                    let argvCounter = 1;

                    for (let i = 0; ; i++) {
                        const constraint = (info as any).nthConstraint(i);
                        if (!constraint) break;
                        if (
                            !constraint.$usable ||
                            constraint.$op !== capi.SQLITE_INDEX_CONSTRAINT_EQ
                        ) {
                            continue;
                        }
                        if (constraint.$iColumn < firstArgColumn) continue;

                        const usage = (info as any).nthConstraintUsage(i);
                        usage.$argvIndex = argvCounter++;
                        usage.$omit = 1;
                    }

                    return capi.SQLITE_OK;
                } finally {
                    info.dispose();
                }
            },

            xOpen(_pVtab: WasmPointer, ppCursor: WasmPointer) {
                vtab.xCursor.create(ppCursor);
                const cursorPtr = wasm.peekPtr(ppCursor) as WasmPointer;
                cursors.set(cursorPtr, {rows: [], index: 0});
                return capi.SQLITE_OK;
            },

            xClose(pCursor: WasmPointer) {
                cursors.delete(pCursor);
                vtab.xCursor.dispose(pCursor);
                return capi.SQLITE_OK;
            },

            xFilter(
                pCursor: WasmPointer,
                _idxNum: number,
                _idxStr: WasmPointer,
                argc: number,
                argv: WasmPointer,
            ) {
                const args: Array<SqlValue> = [];
                for (let i = 0; i < argc; i++) {
                    const pValue = wasm.peekPtr(argv + i * 4) as WasmPointer;
                    const type = capi.sqlite3_value_type(pValue) as number;
                    if (type === capi.SQLITE_NULL) {
                        args.push(null);
                    } else if (type === capi.SQLITE_INTEGER) {
                        args.push(capi.sqlite3_value_int(pValue) as number);
                    } else if (type === capi.SQLITE_FLOAT) {
                        args.push(capi.sqlite3_value_double(pValue) as number);
                    } else {
                        args.push(capi.sqlite3_value_text(pValue) as string);
                    }
                }

                try {
                    const rows = options.compute(...args);
                    const cursor = cursors.get(pCursor)!;
                    cursor.rows = rows;
                    cursor.index = 0;
                    return capi.SQLITE_OK;
                } catch (error) {
                    // Set zErrMsg on the sqlite3_vtab so SQLite propagates it via sqlite3_errmsg().
                    // The cursor's first field is pVtab, and zErrMsg is at offset +8 in the vtab
                    // struct (after pModule and nRef, both 4 bytes on wasm32).
                    const pVtab = wasm.peekPtr(pCursor) as WasmPointer;
                    const msg = error instanceof Error ? error.message : String(error);
                    wasm.pokePtr((pVtab + 8) as WasmPointer, wasm.allocCString(msg, false));
                    return capi.SQLITE_ERROR;
                }
            },

            xEof(pCursor: WasmPointer) {
                const cursor = cursors.get(pCursor)!;
                return cursor.index >= cursor.rows.length ? 1 : 0;
            },

            xNext(pCursor: WasmPointer) {
                cursors.get(pCursor)!.index++;
                return capi.SQLITE_OK;
            },

            xColumn(pCursor: WasmPointer, pCtx: WasmPointer, i: number) {
                const cursor = cursors.get(pCursor)!;
                const value = assertExists(cursor.rows[cursor.index])[i];
                capi.sqlite3_result_js(pCtx, value as any);
                return capi.SQLITE_OK;
            },

            xRowid(pCursor: WasmPointer, ppRowid: WasmPointer) {
                const cursor = cursors.get(pCursor)!;
                vtab.xRowid(ppRowid, cursor.index);
                return capi.SQLITE_OK;
            },
        },
    });

    assert(typeof capi.sqlite3_create_module === "function", "sqlite3_create_module not available");
    const rc = capi.sqlite3_create_module(assertExists(db.pointer), name, mod, 0);
    assert(rc === capi.SQLITE_OK, `sqlite3_create_module failed: rc=${rc}`);
}
