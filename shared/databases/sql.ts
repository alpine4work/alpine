import type {BindableValue, Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    ObjectPropertySchema,
    type ObjectSchemaConfigBase,
    type ObjectSchemaConfigType,
    Schema,
    type SchemaSerializedValue,
} from "~/shared/schema/schema.js";

/**
 * A SQL query with parameter bindings and typed execution
 * helpers. Constructed via the {@link sql} tagged template,
 * {@link sql.raw}, or directly for advanced use cases.
 *
 * ```ts
 * sql`SELECT * FROM t WHERE id = ${id}`.all(db, {
 *     id: Schema.integer,
 *     name: Schema.string,
 * })
 * ```
 *
 * Interpolating a `SqlQuery` inside a tagged template
 * inlines its text and merges its bindings:
 *
 * ```ts
 * const sub = sql`SELECT id FROM other WHERE x = ${42}`;
 * sql`SELECT * FROM t WHERE id IN (${sub})`.all(db, ...)
 * // query: "SELECT * FROM t WHERE id IN (SELECT id FROM other WHERE x = ?)"
 * // bind:  [42]
 * ```
 */
class SqlQuery {
    constructor(
        readonly query: string,
        readonly bind: ReadonlyArray<BindableValue> = [],
    ) {}

    /**
     * Execute and return all result rows, deserialized
     * in a single pass by stepping through the prepared
     * statement column-by-column.
     */
    selectAll<Config extends ObjectSchemaConfigBase>(
        db: Database,
        config: Config,
    ): Array<ObjectSchemaConfigType<Config>> {
        const stmt = db.prepare(this.query);
        try {
            if (this.bind.length > 0) stmt.bind(this.bind as Array<BindableValue>);

            // Map each SQL column index to its config key
            // and value schema for single-pass deserialization.
            const columnNames = stmt.getColumnNames();
            const propertyByColumnName = new Map<string, [string, Schema<unknown>]>();
            for (const [key, schema] of Object.entries(config)) {
                if (schema instanceof ObjectPropertySchema) {
                    propertyByColumnName.set(schema.serializedKey ?? key, [
                        key,
                        schema.valueSchema,
                    ]);
                } else {
                    propertyByColumnName.set(key, [key, schema]);
                }
            }
            const columns = columnNames.map(name => propertyByColumnName.get(name) ?? null);

            const rows: Array<ObjectSchemaConfigType<Config>> = [];
            while (stmt.step()) {
                const row: Record<string, unknown> = {};
                for (let i = 0; i < columns.length; i++) {
                    const col = columns[i];
                    if (col == null) continue;
                    row[col[0]] = col[1].deserialize(stmt.get(i) as SchemaSerializedValue);
                }
                rows.push(row as ObjectSchemaConfigType<Config>);
            }
            return rows;
        } finally {
            stmt.finalize();
        }
    }

    /** Execute and return exactly one row (asserts). */
    selectOne<Config extends ObjectSchemaConfigBase>(
        db: Database,
        config: Config,
    ): ObjectSchemaConfigType<Config> {
        const rows = this.selectAll(db, config);
        assert(rows.length === 1, `Expected 1 row, got ${rows.length}`);
        return rows[0]!;
    }

    /**
     * Execute and return at most one row. Returns `null`
     * when zero rows match.
     */
    selectOneOrNone<Config extends ObjectSchemaConfigBase>(
        db: Database,
        config: Config,
    ): ObjectSchemaConfigType<Config> | null {
        const rows = this.selectAll(db, config);
        assert(rows.length <= 1, `Expected at most 1 row, got ${rows.length}`);
        return rows[0] ?? null;
    }

    /**
     * Execute and return a single scalar value. Asserts
     * exactly one row with one column.
     */
    selectValue<Value>(db: Database, schema: Schema<Value>): Value {
        const stmt = db.prepare(this.query);
        try {
            if (this.bind.length > 0) stmt.bind(this.bind as Array<BindableValue>);
            assert(stmt.columnCount === 1, `Expected 1 column, got ${stmt.columnCount}`);
            assert(stmt.step(), "Expected 1 row, got 0");
            const value = schema.deserialize(stmt.get(0) as SchemaSerializedValue);
            assert(!stmt.step(), "Expected 1 row, got more");
            return value;
        } finally {
            stmt.finalize();
        }
    }

    /**
     * Execute and return all rows as untyped objects. Use
     * when the result schema is not known statically (e.g.
     * user-provided SQL).
     */
    selectAllUnknown(db: Database): Array<Record<string, unknown>> {
        const stmt = db.prepare(this.query);
        try {
            if (this.bind.length > 0) stmt.bind(this.bind as Array<BindableValue>);
            const rows: Array<Record<string, unknown>> = [];
            while (stmt.step()) {
                rows.push(stmt.get({}) as Record<string, unknown>);
            }
            return rows;
        } finally {
            stmt.finalize();
        }
    }

    /**
     * Execute and return all rows as arrays of values.
     * Column order matches the SELECT list. Use when
     * the caller needs positional access rather than
     * named columns.
     *
     * When `schemas` is provided, each column value is
     * deserialized through the corresponding schema
     * (stepping through the prepared statement
     * column-by-column, like {@link selectAll}).
     */
    selectAllArrays(db: Database, schemas: ReadonlyArray<Schema<unknown>>): Array<Array<unknown>> {
        const stmt = db.prepare(this.query);
        try {
            if (this.bind.length > 0) stmt.bind(this.bind as Array<BindableValue>);
            const rows: Array<Array<unknown>> = [];
            while (stmt.step()) {
                const row: Array<unknown> = [];
                for (let i = 0; i < schemas.length; i++) {
                    row.push(schemas[i]!.deserialize(stmt.get(i) as SchemaSerializedValue));
                }
                rows.push(row);
            }
            return rows;
        } finally {
            stmt.finalize();
        }
    }

    /** Execute without returning results (INSERT/UPDATE/DELETE/DDL). */
    exec(db: Database): void {
        db.exec(this.query, {bind: this.bind as Array<BindableValue>});
    }
}

/**
 * Tagged template that builds a {@link SqlQuery}. Interpolated
 * values become `?` placeholders; {@link SqlQuery} values are
 * inlined with their bindings merged.
 *
 * ```ts
 * sql`SELECT * FROM t WHERE id = ${id}`
 * // → SqlQuery { query: "SELECT * FROM t WHERE id = ?", bind: [id] }
 *
 * sql`SELECT * FROM ${sql.identifier("my table")} WHERE id = ${id}`
 * // → SqlQuery { query: 'SELECT * FROM "my table" WHERE id = ?', bind: [id] }
 * ```
 */
function sql(
    strings: TemplateStringsArray,
    ...values: Array<SchemaSerializedValue | SqlQuery>
): SqlQuery {
    let query = "";
    const bind: Array<BindableValue> = [];
    for (let i = 0; i < strings.length; i++) {
        query += strings[i];
        if (i < values.length) {
            const value = values[i];
            if (value instanceof SqlQuery) {
                query += value.query;
                bind.push(...value.bind);
            } else {
                query += "?";
                bind.push(value && typeof value === "object" ? JSON.stringify(value) : value);
            }
        }
    }
    return new SqlQuery(query.replace(/\s+/g, " ").trim(), bind);
}

/**
 * Create a {@link SqlQuery} from a raw SQL string. Use for
 * dynamic SQL or to inline SQL fragments in a tagged
 * template.
 */
sql.raw = (text: string): SqlQuery => new SqlQuery(text);

/**
 * Create a quoted SQL identifier. Double-quotes are escaped
 * per the SQL standard (`"` → `""`). Returns a
 * {@link SqlQuery} that can be interpolated into a tagged
 * template.
 */
// eslint-disable-next-line cyberworlds/string-quotes -- SQL identifier quoting
sql.identifier = (name: string): SqlQuery => new SqlQuery(`"${name.replace(/"/g, '""')}"`);

export {sql, SqlQuery};
