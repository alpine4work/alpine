import type {BindableValue, Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {assert} from "~/shared/helpers/control/assert.js";
import {
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

    /** Execute and return all result rows. */
    selectAll<Config extends ObjectSchemaConfigBase>(
        db: Database,
        config: Config,
    ): Array<ObjectSchemaConfigType<Config>> {
        const schema = Schema.object(config);
        const rawRows = db.exec(this.query, {
            returnValue: "resultRows",
            rowMode: "object",
            bind: this.bind as Array<BindableValue>,
        });
        return rawRows.map(raw => schema.deserialize(raw as Record<string, SchemaSerializedValue>));
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
        const rows = db.exec(this.query, {
            returnValue: "resultRows",
            rowMode: "array",
            bind: this.bind as Array<BindableValue>,
        });
        assert(rows.length === 1, `Expected 1 row, got ${rows.length}`);
        const row = rows[0]!;
        assert(row.length === 1, `Expected 1 column, got ${row.length}`);
        return schema.deserialize(row[0] as SchemaSerializedValue);
    }

    /**
     * Execute and return all rows as untyped objects. Use
     * when the result schema is not known statically (e.g.
     * user-provided SQL).
     */
    selectAllUnknown(db: Database): Array<Record<string, unknown>> {
        return db.exec(this.query, {
            returnValue: "resultRows",
            rowMode: "object",
            bind: this.bind as Array<BindableValue>,
        }) as Array<Record<string, unknown>>;
    }

    /**
     * Execute and return all rows as arrays of values.
     * Column order matches the SELECT list. Use when
     * the caller needs positional access rather than
     * named columns.
     */
    selectAllArrays(db: Database): Array<Array<unknown>> {
        return db.exec(this.query, {
            returnValue: "resultRows",
            rowMode: "array",
            bind: this.bind as Array<BindableValue>,
        }) as Array<Array<unknown>>;
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
function sql(strings: TemplateStringsArray, ...values: Array<BindableValue | SqlQuery>): SqlQuery {
    let query = "";
    const bind: Array<BindableValue> = [];
    for (let i = 0; i < strings.length; i++) {
        query += strings[i];
        if (i < values.length) {
            const v = values[i];
            if (v instanceof SqlQuery) {
                query += v.query;
                bind.push(...v.bind);
            } else {
                query += "?";
                bind.push(v);
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
