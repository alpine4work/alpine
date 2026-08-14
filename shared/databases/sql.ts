import type {BindableValue} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";
import {
    JsonStringifiableUint8Array,
    ObjectPropertySchema,
    type ObjectSchemaConfigBase,
    type ObjectSchemaConfigType,
    Schema,
    type SchemaSerializedObjectValue,
    type SchemaSerializedValue,
} from "~/shared/schema/schema.js";

/**
 * Minimal structural surface of Cloudflare's `SqlStorage` — a durable object's
 * built-in SQLite. Declared structurally rather than importing workers types so
 * this shared module stays platform-neutral; the real `SqlStorage` and the
 * miniflare test polyfill both satisfy it. {@link SqlQuery}'s execution helpers
 * accept it anywhere they accept a wasm {@link SqliteDatabase}.
 */
export interface SqlStorageLike {
    exec(query: string, ...bind: Array<unknown>): SqlStorageLikeCursor;
}

/** See {@link SqlStorageLike}. */
export interface SqlStorageLikeCursor {
    columnNames: Array<string>;
    [Symbol.iterator](): IterableIterator<Record<string, unknown>>;
}

/**
 * A SQL query with parameter bindings and typed execution helpers. Constructed via
 * the {@link sql} tagged template, {@link sql.raw}, or directly for advanced use
 * cases.
 *
 * ```ts
 * sql`SELECT * FROM t WHERE id = ${id}`.all(db, {
 *     id: Schema.integer,
 *     name: Schema.string,
 * });
 * ```
 *
 * Interpolating a `SqlQuery` inside a tagged template inlines its text and merges
 * its bindings:
 *
 * ```ts
 * const sub = sql`SELECT id FROM other WHERE x = ${42}`;
 * sql`SELECT * FROM t WHERE id IN (${sub})`.all(db, ...)
 * // query: "SELECT * FROM t WHERE id IN (SELECT id FROM other WHERE x = ?)"
 * // bind:  [42]
 * ```
 *
 * Every execution helper runs against either a wasm {@link SqliteDatabase} or a
 * durable object's {@link SqlStorageLike}.
 */
class SqlQuery {
    constructor(
        readonly query: string,
        readonly bind: ReadonlyArray<BindableValue> = [],
    ) {}

    /**
     * Execute and return all result rows.
     *
     * Pass a config object of per-column schemas to deserialize in a single pass by
     * stepping through the prepared statement column-by-column, or a whole-row {@link
     * Schema} (e.g. a discriminated `Schema.unionWithKey`) to deserialize each
     * complete row object through it.
     */
    selectAll<Config extends ObjectSchemaConfigBase>(
        db: SqliteDatabase | SqlStorageLike,
        config: Config,
    ): Array<ObjectSchemaConfigType<Config>>;
    selectAll<Value>(db: SqliteDatabase | SqlStorageLike, schema: Schema<Value>): Array<Value>;
    selectAll(
        db: SqliteDatabase | SqlStorageLike,
        config: ObjectSchemaConfigBase | Schema<unknown>,
    ): Array<any> {
        return this.selectAllWithConfig(db, config);
    }

    /** Execute and return exactly one row (asserts). */
    selectOne<Config extends ObjectSchemaConfigBase>(
        db: SqliteDatabase | SqlStorageLike,
        config: Config,
    ): ObjectSchemaConfigType<Config>;
    selectOne<Value>(db: SqliteDatabase | SqlStorageLike, schema: Schema<Value>): Value;
    selectOne(
        db: SqliteDatabase | SqlStorageLike,
        config: ObjectSchemaConfigBase | Schema<unknown>,
    ): any {
        const rows = this.selectAllWithConfig(db, config);
        assert(rows.length === 1, `Expected 1 row, got ${rows.length}`);
        const row = rows[0];
        assert(row !== undefined);
        return row;
    }

    /**
     * Execute and return at most one row. Returns `null` when zero rows match.
     */
    selectOneOrNone<Config extends ObjectSchemaConfigBase>(
        db: SqliteDatabase | SqlStorageLike,
        config: Config,
    ): ObjectSchemaConfigType<Config> | null;
    selectOneOrNone<Value>(
        db: SqliteDatabase | SqlStorageLike,
        schema: Schema<Value>,
    ): Value | null;
    selectOneOrNone(
        db: SqliteDatabase | SqlStorageLike,
        config: ObjectSchemaConfigBase | Schema<unknown>,
    ): any {
        const rows = this.selectAllWithConfig(db, config);
        assert(rows.length <= 1, `Expected at most 1 row, got ${rows.length}`);
        return rows[0] ?? null;
    }

    /**
     * See {@link selectAll} — shared row-reading core behind its two config shapes.
     */
    private selectAllWithConfig(
        db: SqliteDatabase | SqlStorageLike,
        config: ObjectSchemaConfigBase | Schema<unknown>,
    ): Array<any> {
        // A whole-row schema deserializes each complete row object; the optimized
        // per-column path below stays untouched for config objects.
        if (config instanceof Schema) {
            return this.selectAllUnknown(db).map(row =>
                config.deserialize(row as SchemaSerializedValue),
            );
        }
        if (isSqlStorage(db)) {
            const propertyByColumnName = configColumnMapping(config);
            const rows: Array<Record<string, unknown>> = [];
            for (const cursorRow of this.execCursor(db)) {
                const row: Record<string, unknown> = {};
                for (const [columnName, value] of Object.entries(cursorRow)) {
                    const col = propertyByColumnName.get(columnName);
                    if (col == null) continue;
                    row[col[0]] = col[1].deserialize(cursorValue(value));
                }
                rows.push(row);
            }
            return rows;
        }
        const stmt = db.prepare(this.query);
        try {
            if (this.bind.length > 0) stmt.bind(this.bind as Array<BindableValue>);

            // Map each SQL column index to its config key and value schema for single-pass
            // deserialization.
            const columnNames = stmt.getColumnNames();
            const propertyByColumnName = configColumnMapping(config);
            const columns = columnNames.map(name => propertyByColumnName.get(name) ?? null);

            const rows: Array<Record<string, unknown>> = [];
            while (stmt.step()) {
                const row: Record<string, unknown> = {};
                for (let i = 0; i < columns.length; i++) {
                    const col = columns[i];
                    if (col == null) continue;
                    row[col[0]] = col[1].deserialize(stmt.get(i) as SchemaSerializedValue);
                }
                rows.push(row);
            }
            return rows;
        } finally {
            stmt.finalize();
        }
    }

    /**
     * Execute and return a single scalar value. Asserts exactly one row with one
     * column.
     */
    selectValue<Value>(db: SqliteDatabase | SqlStorageLike, schema: Schema<Value>): Value {
        if (isSqlStorage(db)) {
            const values = this.selectValues(db, schema);
            assert(values.length === 1, `Expected 1 row, got ${values.length}`);
            const value = values[0];
            assert(value !== undefined);
            return value;
        }
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
     * Execute and return a single scalar value if it exists. Asserts one or no rows
     * with one column.
     */
    selectValueIfExists<Value>(
        db: SqliteDatabase | SqlStorageLike,
        schema: Schema<Value>,
    ): Value | null {
        if (isSqlStorage(db)) {
            const values = this.selectValues(db, schema);
            assert(values.length <= 1, `Expected 1 or 0 rows, got ${values.length}`);
            return values[0] ?? null;
        }
        const stmt = db.prepare(this.query);
        try {
            if (this.bind.length > 0) stmt.bind(this.bind as Array<BindableValue>);
            assert(stmt.columnCount === 1, `Expected 1 column, got ${stmt.columnCount}`);
            const hasRow = stmt.step();
            if (!hasRow) return null;
            const value = schema.deserialize(stmt.get(0) as SchemaSerializedValue);
            assert(!stmt.step(), "Expected 1 or 0 rows, got more");
            return value;
        } finally {
            stmt.finalize();
        }
    }

    /**
     * Execute and return every row's single column as an array of values, deserialized
     * through `schema`. Asserts the query selects exactly one column.
     */
    selectValues<Value>(db: SqliteDatabase | SqlStorageLike, schema: Schema<Value>): Array<Value> {
        if (isSqlStorage(db)) {
            const cursor = this.execCursor(db);
            const columnCount = cursor.columnNames.length;
            assert(columnCount === 1, `Expected 1 column, got ${columnCount}`);
            const columnName = cursor.columnNames[0] as string;
            const values: Array<Value> = [];
            for (const row of cursor) {
                values.push(schema.deserialize(cursorValue(row[columnName])));
            }
            return values;
        }
        const stmt = db.prepare(this.query);
        try {
            if (this.bind.length > 0) stmt.bind(this.bind as Array<BindableValue>);
            assert(stmt.columnCount === 1, `Expected 1 column, got ${stmt.columnCount}`);
            const values: Array<Value> = [];
            while (stmt.step()) {
                values.push(schema.deserialize(stmt.get(0) as SchemaSerializedValue));
            }
            return values;
        } finally {
            stmt.finalize();
        }
    }

    /**
     * Execute and return all rows as untyped objects. Use when the result schema is
     * not known statically (e.g. user-provided SQL).
     */
    selectAllUnknown(db: SqliteDatabase | SqlStorageLike): Array<SchemaSerializedObjectValue> {
        if (isSqlStorage(db)) {
            const rows: Array<SchemaSerializedObjectValue> = [];
            for (const cursorRow of this.execCursor(db)) {
                const row: {[key: string]: SchemaSerializedValue} = {};
                for (const [columnName, value] of Object.entries(cursorRow)) {
                    row[columnName] = cursorValue(value);
                }
                rows.push(row);
            }
            return rows;
        }
        const stmt = db.prepare(this.query);
        try {
            if (this.bind.length > 0) stmt.bind(this.bind as Array<BindableValue>);
            const rows: Array<SchemaSerializedObjectValue> = [];
            while (stmt.step()) {
                // The wasm API already returns schema-serialized SQLite values. Cast at this
                // trusted boundary instead of copying every property of every row.
                rows.push(stmt.get({}) as SchemaSerializedObjectValue);
            }
            return rows;
        } finally {
            stmt.finalize();
        }
    }

    /**
     * Execute and return all rows as arrays of values. Column order matches the SELECT
     * list. Use when the caller needs positional access rather than named columns.
     *
     * When `schemas` is provided, each column value is deserialized through the
     * corresponding schema (stepping through the prepared statement column-by-column,
     * like {@link selectAll}).
     */
    selectAllArrays(
        db: SqliteDatabase | SqlStorageLike,
        schemas: ReadonlyArray<Pick<Schema<SchemaSerializedValue>, "deserialize">>,
    ): Array<Array<SchemaSerializedValue>> {
        if (isSqlStorage(db)) {
            const cursor = this.execCursor(db);
            const columnNames = cursor.columnNames;
            const rows: Array<Array<SchemaSerializedValue>> = [];
            for (const cursorRow of cursor) {
                const row: Array<SchemaSerializedValue> = [];
                for (let i = 0; i < schemas.length; i++) {
                    // Callers provide schemas in SELECT-list order. The loop bound validates the
                    // schema access; trust the corresponding cursor column at this boundary.
                    const schema = schemas[i] as Pick<Schema<SchemaSerializedValue>, "deserialize">;
                    const columnName = columnNames[i] as string;
                    const value = schema.deserialize(cursorValue(cursorRow[columnName]));
                    row.push(value);
                }
                rows.push(row);
            }
            return rows;
        }
        const stmt = db.prepare(this.query);
        try {
            if (this.bind.length > 0) stmt.bind(this.bind as Array<BindableValue>);
            const rows: Array<Array<SchemaSerializedValue>> = [];
            while (stmt.step()) {
                const row: Array<SchemaSerializedValue> = [];
                for (let i = 0; i < schemas.length; i++) {
                    // The loop bound validates this access. Wasm values already use the
                    // schema-serialized representation, so no normalization is needed.
                    const schema = schemas[i] as Pick<Schema<SchemaSerializedValue>, "deserialize">;
                    const value = schema.deserialize(stmt.get(i) as SchemaSerializedValue);
                    row.push(value);
                }
                rows.push(row);
            }
            return rows;
        } finally {
            stmt.finalize();
        }
    }

    /** Execute without returning results (INSERT/UPDATE/DELETE/DDL). */
    exec(db: SqliteDatabase | SqlStorageLike): void {
        if (isSqlStorage(db)) {
            // Drain the cursor so lazily-executed statements complete before we return.
            const iterator = this.execCursor(db)[Symbol.iterator]();
            while (!iterator.next().done) {
                // Nothing to do with the rows.
            }
            return;
        }
        db.exec(this.query, {bind: this.bind as Array<BindableValue>});
    }

    /**
     * Run this query against a durable object's SQL storage, binding parameters.
     */
    private execCursor(db: SqlStorageLike): SqlStorageLikeCursor {
        return db.exec(this.query, ...this.bind.map(storageBindValue));
    }
}

/**
 * Whether `db` is a durable object's SQL storage rather than a wasm SQLite handle
 * (which is the only one of the two with a prepared-statement API).
 */
function isSqlStorage(db: SqliteDatabase | SqlStorageLike): db is SqlStorageLike {
    return !("prepare" in db);
}

/**
 * Map each SQL column name to its config key and value schema, honoring {@link
 * ObjectPropertySchema} column renames.
 */
function configColumnMapping(
    config: ObjectSchemaConfigBase,
): Map<string, [string, Schema<unknown>]> {
    const propertyByColumnName = new Map<string, [string, Schema<unknown>]>();
    for (const [key, schema] of Object.entries(config)) {
        if (schema instanceof ObjectPropertySchema) {
            propertyByColumnName.set(schema.serializedKey ?? key, [key, schema.valueSchema]);
        } else {
            propertyByColumnName.set(key, [key, schema]);
        }
    }
    return propertyByColumnName;
}

/**
 * Convert a {@link SqlQuery} binding to what `SqlStorage.exec` accepts: it takes
 * `ArrayBuffer` for blobs where the wasm API takes `Uint8Array`. A view over a
 * whole buffer passes that buffer through without copying (the page-write hot
 * path); a partial view must be sliced out.
 */
function storageBindValue(value: BindableValue): unknown {
    if (value instanceof Uint8Array) {
        return value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
            ? value.buffer
            : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    return value;
}

/**
 * Normalize a `SqlStorage` result value for schema deserialization: blobs come
 * back as `ArrayBuffer`s where the wasm API produces `Uint8Array`s.
 */
function cursorValue(value: unknown): SchemaSerializedValue {
    if (value instanceof ArrayBuffer) return new JsonStringifiableUint8Array(value);
    return value as SchemaSerializedValue;
}

/**
 * Tagged template that builds a {@link SqlQuery}. Interpolated values become `?`
 * placeholders; {@link SqlQuery} values are inlined with their bindings merged.
 *
 * ```ts
 * sql`SELECT * FROM t WHERE id = ${id}`;
 * // → SqlQuery { query: "SELECT * FROM t WHERE id = ?", bind: [id] }
 *
 * sql`SELECT * FROM ${sql.identifier("my table")} WHERE id = ${id}`;
 * // → SqlQuery { query: 'SELECT * FROM "my table" WHERE id = ?', bind: [id] }
 * ```
 */
function sql(
    strings: TemplateStringsArray,
    ...values: Array<SchemaSerializedValue | Uint8Array | SqlQuery>
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
                // Bind plain objects/arrays as JSON text. A Uint8Array (incl.
                // JsonStringifiableUint8Array) passes through untouched so SQLite binds it as a
                // BLOB — JSON-stringifying would corrupt it into `{"0":12,...}`.
                bind.push(
                    value !== null && typeof value === "object" && !(value instanceof Uint8Array)
                        ? JSON.stringify(value)
                        : value,
                );
            }
        }
    }
    return new SqlQuery(query, bind);
}

/**
 * Create a {@link SqlQuery} from a raw SQL string. Use for dynamic SQL or to
 * inline SQL fragments in a tagged template.
 */
sql.raw = (text: string): SqlQuery => new SqlQuery(text);

/**
 * Create a quoted SQL identifier. Double-quotes are escaped per the SQL standard
 * (`"` → `""`). Multiple names are joined as a qualified identifier. Returns a
 * {@link SqlQuery} that can be interpolated into a tagged template.
 */
sql.identifier = (name: string, ...moreNames: Array<string>): SqlQuery =>
    sql.raw(
        [name, ...moreNames]
            // eslint-disable-next-line cyberworlds/string-quotes -- SQL identifier quoting
            .map(identifierName => `"${identifierName.replace(/"/g, '""')}"`)
            .join("."),
    );

/**
 * Join an array of {@link SqlQuery}s with a separator.
 */
sql.join = (queries: Array<SqlQuery>, separator: string): SqlQuery => {
    const texts = [];
    const bindings = [];

    for (const query of queries) {
        texts.push(query.query);
        bindings.push(...query.bind);
    }

    return new SqlQuery(texts.join(separator), bindings);
};

/**
 * Prefix for the SQLite schema name of a table's `ATTACH`-ed per-db file.
 * Deliberately verbose and unique so it can be matched back out of SQLite's "no
 * such table" / "unknown database" error text to recover the {@link
 * DatabaseTableId} (see `Database`'s unattached-table detection). The leading `_`
 * also marks it internal, matching the `_alpine_*` table convention.
 */
export const databaseTableSchemaNamePrefix = "_alpine_table_schema_";

/**
 * SQLite schema name for a table's `ATTACH`-ed per-db file: {@link
 * databaseTableSchemaNamePrefix} followed by the table id. Both {@link
 * sql.tableRef} and {@link Database.attach} use this so the attach name and every
 * reference to it stay in sync.
 */
export function databaseTableSchemaName(tableId: DatabaseTableId): string {
    return `${databaseTableSchemaNamePrefix}${tableId}`;
}

/**
 * Create a schema-qualified SQL identifier,
 * `"_alpine_table_schema_{tableId}"."name"`, for referencing a table (or index) in
 * a {@link DatabaseTableId}'s `ATTACH`-ed per-db file. Both parts are quoted and
 * escaped via {@link sql.identifier}.
 */
sql.tableRef = (schema: DatabaseTableId, name?: string): SqlQuery =>
    name
        ? sql.identifier(databaseTableSchemaName(schema), name)
        : sql.identifier(databaseTableSchemaName(schema));

export {sql, SqlQuery};
