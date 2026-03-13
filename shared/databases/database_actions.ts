import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {type ObjectSchema, Schema, type SchemaType} from "~/shared/schema/schema.js";

/**
 * Defines a database action with typed input/output
 * schemas, a write level, and a shared `run()` function
 * that executes on both client and server.
 */
function defineDatabaseAction<Input, Output>(def: {
    input: ObjectSchema<Input>;
    output: ObjectSchema<Output>;
    writeLevel: SqliteWriteLevel;
    run: (db: Database, input: Input) => any;
}): {
    input: ObjectSchema<Input>;
    output: ObjectSchema<Output>;
    writeLevel: SqliteWriteLevel;
    run: (db: Database, input: Input) => Output;
} {
    return def;
}

export const databaseActions = {
    rawSql: defineDatabaseAction({
        input: Schema.object({sql: Schema.string}),
        output: Schema.object({rows: Schema.array(Schema.unknown())}),
        writeLevel: "data",
        run(db, {sql}) {
            const rows = db.exec(sql, {
                returnValue: "resultRows",
                rowMode: "object",
            }) as Array<Record<string, unknown>>;
            return {rows};
        },
    }),

    createTable: defineDatabaseAction({
        input: Schema.object({name: Schema.string}),
        output: Schema.object({tableId: Schema.integer, tableName: Schema.string}),
        writeLevel: "schema+data",
        run(db, {name}) {
            const tableName = toSqlName(db, name);

            db.exec(`INSERT INTO _alpine_tables (name, table_name) VALUES (?, ?)`, {
                bind: [name, tableName],
            });
            const tableId = db.selectValue("SELECT last_insert_rowid()") as number;

            // eslint-disable-next-line cyberworlds/string-quotes
            const fieldType = '{"type":"plainText"}';
            db.exec(
                `INSERT INTO _alpine_fields (table_id, name, column_name, type)
                 VALUES (?, ?, ?, ?)`,
                {bind: [tableId, "Name", "name", fieldType]},
            );
            const fieldId = db.selectValue("SELECT last_insert_rowid()") as number;

            const sqliteType = alpineFieldTypeToSqliteType("plainText");
            const nameCheck = checkConstraintForColumn("name", sqliteType, true);

            /* eslint-disable cyberworlds/string-quotes */
            db.exec(
                `CREATE TABLE ${tableName} (
                    _id INTEGER PRIMARY KEY,
                    _created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    name ${sqliteType}_alpine_${fieldId} NOT NULL DEFAULT '',
                    CHECK(datetime(_created_at) IS NOT NULL),
                    ${nameCheck}
                )`,
            );
            /* eslint-enable cyberworlds/string-quotes */
            db.exec(`CREATE INDEX ${tableName}__created_at ON ${tableName}(_created_at)`);

            return {tableId, tableName};
        },
    }),
};

// -- Helpers (module-private) ------------------------------------------------

/**
 * Derive a unique, SQL-safe table name from a
 * human-readable name.
 */
function toSqlName(db: Database, name: string): string {
    // Slugify: lowercase, replace non-alphanumeric
    // with `_`, collapse runs.
    let slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_")
        .replace(/_+/g, "_");

    // Strip leading underscores.
    slug = slug.replace(/^_+/, "");

    // Rewrite sqlite_ prefix.
    if (slug.startsWith("sqlite_")) {
        slug = "x_" + slug;
    }

    // If empty or starts with digit, prefix x_.
    if (slug === "" || /^[0-9]/.test(slug)) {
        slug = "x_" + slug;
    }

    // Strip trailing underscores.
    slug = slug.replace(/_+$/, "");

    // Ensure uniqueness against existing table names.
    const existing = new Set(
        (
            db.exec("SELECT table_name FROM _alpine_tables", {
                returnValue: "resultRows",
                rowMode: "array",
            }) as Array<[string]>
        ).map(row => row[0]),
    );

    if (!existing.has(slug)) return slug;

    for (let i = 2; ; i++) {
        const candidate = `${slug}_${i}`;
        if (!existing.has(candidate)) return candidate;
    }
}

/**
 * Map an Alpine field type name to a SQLite column
 * type affinity.
 */
function alpineFieldTypeToSqliteType(type: string): string {
    switch (type) {
        case "plainText":
            return "TEXT";
        case "number":
            return "REAL";
        case "boolean":
            return "INTEGER";
        default:
            assert(false, `unknown Alpine field type: ${type}`);
    }
}

/**
 * Generate a CHECK constraint for a column based on its
 * SQLite type affinity and nullability.
 */
function checkConstraintForColumn(
    columnName: string,
    sqliteType: string,
    notNull: boolean,
): string {
    /* eslint-disable cyberworlds/string-quotes */
    switch (sqliteType) {
        case "TEXT":
            return notNull
                ? `CHECK(typeof(${columnName}) = 'text')`
                : `CHECK(typeof(${columnName}) = 'text' OR ${columnName} IS NULL)`;
        case "REAL":
            return notNull
                ? `CHECK(typeof(${columnName}) IN ('real', 'integer'))`
                : `CHECK(typeof(${columnName}) IN ('real', 'integer') OR ${columnName} IS NULL)`;
        case "INTEGER":
            return notNull
                ? `CHECK(typeof(${columnName}) = 'integer')`
                : `CHECK(typeof(${columnName}) = 'integer' OR ${columnName} IS NULL)`;
        default:
            assert(false, `unsupported SQLite type: ${sqliteType}`);
    }
    /* eslint-enable cyberworlds/string-quotes */
}

// -- Exported test helpers ---------------------------------------------------

export const _testHelpers = {
    toSqlName,
    alpineFieldTypeToSqliteType,
    checkConstraintForColumn,
};

// -- Derived types -----------------------------------------------------------

export type DatabaseActionName = keyof typeof databaseActions;

export type DatabaseActionInput<N extends DatabaseActionName> = SchemaType<
    (typeof databaseActions)[N]["input"]
>;

export type DatabaseActionOutput<N extends DatabaseActionName> = SchemaType<
    (typeof databaseActions)[N]["output"]
>;

export type DatabaseActionObject<N extends DatabaseActionName = DatabaseActionName> = {
    [K in DatabaseActionName]: {name: K; input: DatabaseActionInput<K>};
}[N];

export type DatabaseActionResult<N extends DatabaseActionName = DatabaseActionName> = {
    [K in DatabaseActionName]: {name: K; output: DatabaseActionOutput<K>};
}[N];

// -- Derived schemas ---------------------------------------------------------

/**
 * Schema for action request objects: `{name, input}`.
 * Discriminated union keyed on `name`.
 */
export const DatabaseActionObjectSchema = Schema.unionWithKey(
    "name",
    Object.fromEntries(
        Object.entries(databaseActions).map(([name, def]) => [
            name,
            Schema.object({name: Schema.value(name), input: def.input}),
        ]),
    ) as {
        [K in DatabaseActionName]: ObjectSchema<{
            readonly name: K;
            readonly input: DatabaseActionInput<K>;
        }>;
    },
);

/**
 * Schema for action result objects: `{name, output}`.
 * Discriminated union keyed on `name`.
 */
export const DatabaseActionResultSchema = Schema.unionWithKey(
    "name",
    Object.fromEntries(
        Object.entries(databaseActions).map(([name, def]) => [
            name,
            Schema.object({name: Schema.value(name), output: def.output}),
        ]),
    ) as {
        [K in DatabaseActionName]: ObjectSchema<{
            readonly name: K;
            readonly output: DatabaseActionOutput<K>;
        }>;
    },
);
