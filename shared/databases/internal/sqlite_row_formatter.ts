import type {BindingSpec, Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {assert} from "~/shared/helpers/control/assert.js";
import type {ObjectSchema, SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * Typed row formatter that executes SQL, validates and
 * deserializes each row against an `ObjectSchema`, and
 * returns strongly typed results.
 *
 * Use `originalPropertyKey` to remap SQL column names to
 * JS property names:
 *
 * ```ts
 * const Row = new SqliteRowFormatter(
 *     Schema.object({
 *         id: Schema.id<DatabaseTableId>(),
 *         tableName: Schema.string.originalPropertyKey("table_name"),
 *     }),
 * );
 * const rows = Row.all(db, "SELECT id, table_name FROM _alpine_tables");
 * // → Array<{readonly id: DatabaseTableId; readonly tableName: string}>
 * ```
 */
export class SqliteRowFormatter<Row> {
    private readonly schema: ObjectSchema<Row>;

    constructor(schema: ObjectSchema<Row>) {
        this.schema = schema;
    }

    /** Execute SQL and return all result rows. */
    all(db: Database, sql: string, bind?: BindingSpec): Array<Row> {
        const rawRows = bind
            ? db.exec(sql, {returnValue: "resultRows", rowMode: "object", bind})
            : db.exec(sql, {returnValue: "resultRows", rowMode: "object"});
        return rawRows.map(raw =>
            this.schema.deserialize(raw as Record<string, SchemaSerializedValue>),
        );
    }

    /** Execute SQL and return exactly one row (asserts). */
    one(db: Database, sql: string, bind?: BindingSpec): Row {
        const rows = this.all(db, sql, bind);
        assert(rows.length === 1, `Expected 1 row, got ${rows.length}`);
        return rows[0]!;
    }

    /**
     * Execute SQL and return at most one row. Returns
     * `null` when zero rows match.
     */
    oneOrNone(db: Database, sql: string, bind?: BindingSpec): Row | null {
        const rows = this.all(db, sql, bind);
        assert(rows.length <= 1, `Expected at most 1 row, got ${rows.length}`);
        return rows[0] ?? null;
    }
}
