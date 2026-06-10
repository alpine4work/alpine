/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {
    type DatabaseActionContext,
    type DatabaseActionInput,
    type DatabaseActionName,
    type DatabaseActionOutput,
    databaseActions,
} from "~/shared/databases/database_actions.js";
import {DatabaseFieldConfigSqlSchema} from "~/shared/databases/fields/database_field_providers.js";
import {databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {
    runJoinTableMigrations,
    runMainMigrations,
    runTableMigrations,
    tableSqliteMigrations,
} from "~/shared/databases/sqlite_migrations.js";
import type {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {isId} from "~/shared/id/id.js";
import type {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDb(): Promise<Database> {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-actions-${dbCounter++}.sqlite3`, "ct");
    registerSqliteCustomFunctions(sqlite3, db);
    runMainMigrations(db);
    return db;
}

function attachTableDb(db: Database, tableId: DatabaseTableId): void {
    sql` ATTACH DATABASE ':memory:' AS ${sql.identifier(databaseTableSchemaName(tableId))} `.exec(
        db,
    );
}

/**
 * Action context for the raw test handle. There's no VFS here, so a table's per-db
 * file is simulated with an in-memory attached database under the table id's
 * schema.
 */
function makeCtx(db: Database): DatabaseActionContext {
    return {
        db,
        server: {
            attach(tableId) {
                attachTableDb(db, tableId);
            },
        },
    };
}

/** Run an action with a freshly-built context. */
function run<N extends DatabaseActionName>(
    db: Database,
    name: N,
    input: DatabaseActionInput<N>,
): DatabaseActionOutput<N> {
    return databaseActions[name].run(makeCtx(db), input as never) as DatabaseActionOutput<N>;
}

describe("sqlite migrations", () => {
    test("main migration backfills existing table rows as user tables", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB(`/test-main-migration-${dbCounter++}.sqlite3`, "ct");
        registerSqliteCustomFunctions(sqlite3, db);
        const tableId = generateChronologicalId<DatabaseTableId>();

        db.exec(`CREATE TABLE _alpine_tables (
            id TEXT PRIMARY KEY,
            CHECK(is_id(id))
        ) STRICT, WITHOUT ROWID`);
        db.exec(`CREATE TABLE _alpine_views (
            id TEXT PRIMARY KEY,
            table_id TEXT NOT NULL REFERENCES _alpine_tables(id),
            CHECK(is_id(id)),
            CHECK(is_id(table_id))
        ) STRICT, WITHOUT ROWID`);
        db.exec(`CREATE INDEX _alpine_views_table_id ON _alpine_views(table_id)`);
        sql`
            INSERT INTO
                _alpine_tables (id)
            VALUES
                (${tableId})
        `.exec(db);
        db.exec("PRAGMA user_version = 1");

        runMainMigrations(db);

        const rows = sql`
            SELECT
                *
            FROM
                _alpine_tables
        `.selectAllUnknown(db);
        expect(rows).toEqual([{id: tableId, kind: "table"}]);
        db.close();
    });

    test("table migration backfills name_field_id from the first field id", async () => {
        const db = await createDb();
        const tableId = generateChronologicalId<DatabaseTableId>();
        const firstFieldId = generateChronologicalId<DatabaseFieldId>();
        const secondFieldId = generateChronologicalId<DatabaseFieldId>();
        attachTableDb(db, tableId);
        tableSqliteMigrations[0]!(db, tableId);
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, "_alpine_table")} (id, name, table_name)
            VALUES
                (
                    ${tableId},
                    'Tasks',
                    'tasks'
                )
        `.exec(db);
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, "_alpine_fields")} (id, table_id, name, column_name, config)
            VALUES
                (
                    ${secondFieldId},
                    ${tableId},
                    'Second',
                    'second',
                    ${DatabaseFieldConfigSqlSchema.serialize({type: "plainText"})}
                ),
                (
                    ${firstFieldId},
                    ${tableId},
                    'First',
                    'first',
                    ${DatabaseFieldConfigSqlSchema.serialize({type: "plainText"})}
                )
        `.exec(db);
        sql` PRAGMA ${sql.identifier(databaseTableSchemaName(tableId))}.user_version = 1 `.exec(db);

        runTableMigrations(db, tableId);

        const row = sql`
            SELECT
                name_field_id
            FROM
                ${sql.tableRef(tableId, "_alpine_table")}
        `.selectOne(db, {
            nameFieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("name_field_id"),
        });
        expect(row.nameFieldId).toBe(firstFieldId);
        db.close();
    });

    test("join table migration creates metadata, links, and non-unique link indexes", async () => {
        const db = await createDb();
        const joinTableId = generateChronologicalId<DatabaseTableId>();
        const sourceTableId = generateChronologicalId<DatabaseTableId>();
        const sourceFieldId = generateChronologicalId<DatabaseFieldId>();
        const targetTableId = generateChronologicalId<DatabaseTableId>();
        const targetFieldId = generateChronologicalId<DatabaseFieldId>();
        const sourceRowId = generateChronologicalId<DatabaseRowId>();
        const targetRowId = generateChronologicalId<DatabaseRowId>();
        attachTableDb(db, joinTableId);

        runJoinTableMigrations(db, joinTableId);
        sql`
            INSERT INTO
                ${sql.tableRef(joinTableId, "_alpine_join_table")} (
                    id,
                    source_table_id,
                    source_field_id,
                    target_table_id,
                    target_field_id
                )
            VALUES
                (
                    ${joinTableId},
                    ${sourceTableId},
                    ${sourceFieldId},
                    ${targetTableId},
                    ${targetFieldId}
                )
        `.exec(db);
        sql`
            INSERT INTO
                ${sql.tableRef(joinTableId, "_alpine_links")} (source_row_id, target_row_id)
            VALUES
                (
                    ${sourceRowId},
                    ${targetRowId}
                ),
                (
                    ${sourceRowId},
                    ${targetRowId}
                )
        `.exec(db);

        const linkCount = sql`
            SELECT
                COUNT(*)
            FROM
                ${sql.tableRef(joinTableId, "_alpine_links")}
        `.selectValue(db, Schema.integer);
        const indexes = sql`
            PRAGMA ${sql.tableRef(joinTableId, "index_list")} (${sql.identifier("_alpine_links")})
        `.selectAllUnknown(db);

        expect({
            linkCount,
            indexNames: indexes.map(index => index.name).sort(),
            uniqueFlags: indexes.map(index => index.unique),
        }).toMatchObject({
            linkCount: 2,
            indexNames: ["_alpine_links_source", "_alpine_links_target"],
            uniqueFlags: [0, 0],
        });
        db.close();
    });
});

describe("createTable", () => {
    test("registers an id-only row in the main database", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "Tasks"});

        expect(isId(tableId)).toBe(true);
        expect(tableName).toBe("tasks");

        // The public main database holds only ids and storage kind — no name.
        const tables = sql`
            SELECT
                *
            FROM
                _alpine_tables
        `.selectAllUnknown(db);
        expect(tables).toEqual([{id: tableId, kind: "table"}]);
        db.close();
    });

    test("stores the table name and identifier in its per-db file", async () => {
        const db = await createDb();
        const {tableId} = run(db, "createTable", {name: "Tasks"});

        const row = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(tableId, "_alpine_table")}
        `.selectAllUnknown(db);
        expect(row).toMatchObject([
            {id: tableId, name: "Tasks", table_name: "tasks", name_field_id: expect.any(String)},
        ]);
        db.close();
    });

    test("stores the initial Name field as the record-name field", async () => {
        const db = await createDb();
        const {tableId} = run(db, "createTable", {name: "Tasks"});

        const fields = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(tableId, "_alpine_fields")}
        `.selectAllUnknown(db);
        const table = sql`
            SELECT
                name_field_id
            FROM
                ${sql.tableRef(tableId, "_alpine_table")}
        `.selectOne(db, {
            nameFieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("name_field_id"),
        });

        expect(fields).toMatchObject([
            {
                table_id: tableId,
                name: "Name",
                column_name: "name",
                config: DatabaseFieldConfigSqlSchema.serialize({type: "plainText"}),
            },
        ]);
        expect(table.nameFieldId).toBe(fields[0]!.id);
        db.close();
    });

    test("creates a queryable table with system columns", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "Tasks"});

        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (name)
            VALUES
                ('Do laundry')
        `.exec(db);
        const rows = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(tableId, tableName)}
        `.selectAllUnknown(db);

        expect(isId(rows[0]!._id as string)).toBe(true);
        expect(rows).toMatchObject([{name: "Do laundry"}]);
        expect(rows[0]!._created_at).toBeDefined();
    });

    test("_id auto-generates a ChronologicalId", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});

        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (name)
            VALUES
                ('a')
        `.exec(db);
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (name)
            VALUES
                ('b')
        `.exec(db);
        const rows = sql`
            SELECT
                _id
            FROM
                ${sql.tableRef(tableId, tableName)}
            ORDER BY
                _id
        `.selectAllUnknown(db);

        expect(rows).toHaveLength(2);
        expect(isId(rows[0]!._id as string)).toBe(true);
        expect(isId(rows[1]!._id as string)).toBe(true);
        expect(rows[0]!._id).not.toBe(rows[1]!._id);
    });

    test("_created_at auto-populates with datetime", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});

        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (name)
            VALUES
                ('x')
        `.exec(db);
        const createdAt = sql`
            SELECT
                _created_at
            FROM
                ${sql.tableRef(tableId, tableName)}
        `.selectOne(db, {
            createdAt: Schema.string.originalPropertyKey("_created_at"),
        }).createdAt;

        // Matches YYYY-MM-DD HH:MM:SS format.
        expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    test("_created_at CHECK rejects unparseable values", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});

        expect(() => {
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, tableName)} (_created_at, name)
                VALUES
                    ('not-a-date', 'x')
            `.exec(db);
        }).toThrow("CHECK");
    });

    test("name column defaults to empty string", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});

        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} DEFAULT
            VALUES
        `.exec(db);
        const name = sql`
            SELECT
                name
            FROM
                ${sql.tableRef(tableId, tableName)}
        `.selectOne(db, {
            name: Schema.string,
        }).name;
        expect(name).toBe("");
    });

    test("name column CHECK rejects blobs", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});

        expect(() => {
            // `sql.raw` for the blob literal: the sql template JSON-encodes bound objects, so
            // a blob value can't go through a `?` parameter.
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, tableName)} (name)
                VALUES
                    (${sql.raw("x'00'")})
            `.exec(db);
        }).toThrow("CHECK");
    });

    test("column type is encoded in type name", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});

        const colInfo = sql`
            PRAGMA ${sql.tableRef(tableId, "table_info")} (${sql.identifier(tableName)})
        `.selectAllUnknown(db);

        const nameCol = colInfo.find(c => c.name === "name");
        expect(nameCol!.type).toMatch(/^TEXT_alpine_[0-9a-z]{26}$/);
    });

    test("duplicate names each land in their own file (no cross-table dedup)", async () => {
        const db = await createDb();
        const first = run(db, "createTable", {name: "Tasks"});
        const second = run(db, "createTable", {name: "Tasks"});

        // Each table owns its own per-db file, so the SQLite identifier only needs to be
        // unique within that file — no "\_2" suffix across tables.
        expect(first.tableName).toBe("tasks");
        expect(second.tableName).toBe("tasks");
    });

    test("index exists on _created_at", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});

        const indexes = sql`
            PRAGMA ${sql.tableRef(tableId, "index_list")} (${sql.identifier(tableName)})
        `.selectAllUnknown(db);

        expect(indexes.some(idx => (idx.name as string).includes("_created_at"))).toBe(true);
        db.close();
    });

    test("creates a default view in the per-db file", async () => {
        const db = await createDb();
        const {tableId, viewId} = run(db, "createTable", {name: "Tasks"});

        const views = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(tableId, "_alpine_views")}
            WHERE
                table_id = ${tableId}
        `.selectAllUnknown(db);

        expect(views).toMatchObject([{id: viewId, table_id: tableId, name: "Grid view"}]);
        db.close();
    });

    test("records the view in the main routing index", async () => {
        const db = await createDb();
        const {tableId, viewId} = run(db, "createTable", {name: "Tasks"});

        const views = sql`
            SELECT
                *
            FROM
                _alpine_views
        `.selectAllUnknown(db);

        // The main index is ids only — no name.
        expect(views).toEqual([{id: viewId, table_id: tableId}]);
        db.close();
    });

    test("returns viewId", async () => {
        const db = await createDb();
        const {viewId} = run(db, "createTable", {name: "Tasks"});

        expect(isId(viewId)).toBe(true);
        db.close();
    });

    test("default view contains the Name field", async () => {
        const db = await createDb();
        const {tableId, viewId} = run(db, "createTable", {name: "Tasks"});

        const viewFields = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(tableId, "_alpine_view_fields")}
            WHERE
                view_id = ${viewId}
        `.selectAllUnknown(db);

        expect(viewFields).toMatchObject([
            {view_id: viewId, width: databaseViewDefaultColumnWidth},
        ]);
        expect(typeof viewFields[0]!.position).toBe("string");
        db.close();
    });
});

describe("getViewSchema", () => {
    test("returns position and hidden in field output", async () => {
        const db = await createDb();
        const {viewId} = run(db, "createTable", {name: "T"});
        const result = run(db, "getViewSchema", {tableOrViewId: viewId});

        expect(result.fields).toHaveLength(1);
        expect(typeof result.fields[0]!.position).toBe("string");
        expect(result.fields[0]!.hidden).toBe(false);
        db.close();
    });

    test("hidden field is included with hidden=true", async () => {
        const db = await createDb();
        const {tableId, viewId} = run(db, "createTable", {name: "T"});

        const {fieldId: secondFieldId} = addFieldAndGetId(db, tableId, viewId, "Status");
        run(db, "updateFieldViewVisibility", {
            tableId,
            viewId,
            fieldId: secondFieldId,
            position: "a1" as OrderKey,
            isHidden: true,
        });

        const result = run(db, "getViewSchema", {tableOrViewId: viewId});
        expect(result.fields).toHaveLength(2);

        const hidden = result.fields.find(f => f.id === secondFieldId)!;
        expect(hidden.hidden).toBe(true);

        const visible = result.fields.find(f => f.id !== secondFieldId)!;
        expect(visible.hidden).toBe(false);
        db.close();
    });
});

describe("updateFieldViewVisibility", () => {
    test("updates position and hidden flag", async () => {
        const db = await createDb();
        const {tableId, viewId} = run(db, "createTable", {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        run(db, "updateFieldViewVisibility", {
            tableId,
            viewId,
            fieldId,
            position: "a1" as OrderKey,
            isHidden: true,
        });

        const row = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(tableId, "_alpine_view_fields")}
            WHERE
                view_id = ${viewId}
                AND field_id = ${fieldId}
        `.selectAllUnknown(db);
        expect(row).toMatchObject([{position: "a1", hidden: 1}]);
        db.close();
    });

    test("can toggle back to visible", async () => {
        const db = await createDb();
        const {tableId, viewId} = run(db, "createTable", {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        run(db, "updateFieldViewVisibility", {
            tableId,
            viewId,
            fieldId,
            position: "a1" as OrderKey,
            isHidden: true,
        });
        run(db, "updateFieldViewVisibility", {
            tableId,
            viewId,
            fieldId,
            position: "a2" as OrderKey,
            isHidden: false,
        });

        const row = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(tableId, "_alpine_view_fields")}
            WHERE
                view_id = ${viewId}
                AND field_id = ${fieldId}
        `.selectAllUnknown(db);
        expect(row).toMatchObject([{position: "a2", hidden: 0}]);
        db.close();
    });
});

/** Helper: creates a field via the action and returns its id. */
function addFieldAndGetId(
    db: Database,
    tableId: DatabaseTableId,
    viewId: DatabaseViewId,
    name: string,
    type: "plainText" | "checkbox" | "number" = "plainText",
) {
    const fieldId = generateChronologicalId<DatabaseFieldId>();
    run(db, "createField", {fieldId, tableId, viewId, name, type});
    return {fieldId};
}

function createRowAndGetId(db: Database, tableId: DatabaseTableId): DatabaseRowId {
    const rowId = generateChronologicalId<DatabaseRowId>();
    run(db, "createRow", {tableId, rowId});
    return rowId;
}

function readNameFieldId(db: Database, tableId: DatabaseTableId): DatabaseFieldId {
    return sql`
        SELECT
            name_field_id
        FROM
            ${sql.tableRef(tableId, "_alpine_table")}
    `.selectValue(db, Schema.id<DatabaseFieldId>());
}

/**
 * Helper: inserts relation metadata without implementing createRelationField.
 */
function addRelationFieldMetadata(
    db: Database,
    tableId: DatabaseTableId,
    viewId: DatabaseViewId,
    name = "Links",
) {
    const fieldId = generateChronologicalId<DatabaseFieldId>();
    const joinTableId = generateChronologicalId<DatabaseTableId>();
    const config = {
        type: "relation" as const,
        joinTableId,
        side: "source" as const,
        cardinality: "many" as const,
        linkedTableId: tableId,
    };
    const maxPosition = sql`
        SELECT
            MAX(position)
        FROM
            ${sql.tableRef(tableId, "_alpine_view_fields")}
        WHERE
            view_id = ${viewId}
    `.selectValue(db, Schema.string.nullable());
    sql`
        INSERT INTO
            ${sql.tableRef(tableId, "_alpine_fields")} (id, table_id, name, column_name, config)
        VALUES
            (
                ${fieldId},
                ${tableId},
                ${name},
                ${"links"},
                ${DatabaseFieldConfigSqlSchema.serialize(config)}
            )
    `.exec(db);
    sql`
        INSERT INTO
            ${sql.tableRef(tableId, "_alpine_view_fields")} (view_id, field_id, position, width)
        VALUES
            (
                ${viewId},
                ${fieldId},
                generate_order_key (${maxPosition}, NULL),
                ${databaseViewDefaultColumnWidth}
            )
    `.exec(db);
    return {fieldId, config};
}

function readFieldById(
    db: Database,
    tableId: DatabaseTableId,
    fieldId: DatabaseFieldId,
): {id: DatabaseFieldId; name: string; config: unknown} {
    return sql`
        SELECT
            id,
            name,
            config
        FROM
            ${sql.tableRef(tableId, "_alpine_fields")}
        WHERE
            id = ${fieldId}
    `.selectOne(db, {
        id: Schema.id<DatabaseFieldId>(),
        name: Schema.string,
        config: DatabaseFieldConfigSqlSchema,
    });
}

function readLinks(
    db: Database,
    joinTableId: DatabaseTableId,
): Array<{sourceRowId: DatabaseRowId; targetRowId: DatabaseRowId}> {
    return sql`
        SELECT
            source_row_id,
            target_row_id
        FROM
            ${sql.tableRef(joinTableId, "_alpine_links")}
        ORDER BY
            source_row_id,
            target_row_id
    `.selectAll(db, {
        sourceRowId: Schema.id<DatabaseRowId>().originalPropertyKey("source_row_id"),
        targetRowId: Schema.id<DatabaseRowId>().originalPropertyKey("target_row_id"),
    });
}

describe("rawSql", () => {
    test("SELECT passes rows through", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (name)
            VALUES
                ('a'),
                ('b')
        `.exec(db);

        const {rows} = run(db, "rawSql", {
            sql: `SELECT name FROM ${sql.tableRef(tableId, tableName).query} ORDER BY name`,
        });

        expect(rows).toMatchObject([{name: "a"}, {name: "b"}]);
        db.close();
    });

    test("INSERT goes through (writeLevel: data)", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});

        run(db, "rawSql", {
            sql: `INSERT INTO ${sql.tableRef(tableId, tableName).query} (name) VALUES ('inserted')`,
        });

        const rows = sql`
            SELECT
                name
            FROM
                ${sql.tableRef(tableId, tableName)}
        `.selectAllUnknown(db);
        expect(rows).toMatchObject([{name: "inserted"}]);
        db.close();
    });
});

describe("readonlyRawSql", () => {
    test("SELECT passes rows through", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (name)
            VALUES
                ('hello')
        `.exec(db);

        const {rows} = run(db, "readonlyRawSql", {
            sql: `SELECT name FROM ${sql.tableRef(tableId, tableName).query}`,
        });

        expect(rows).toMatchObject([{name: "hello"}]);
        db.close();
    });

    test("returns empty array for empty result set", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});

        const {rows} = run(db, "readonlyRawSql", {
            sql: `SELECT * FROM ${sql.tableRef(tableId, tableName).query}`,
        });

        expect(rows).toEqual([]);
        db.close();
    });
});

describe("listTableIds", () => {
    test("returns table ids in id order", async () => {
        const db = await createDb();
        const first = run(db, "createTable", {name: "Tasks"});
        const second = run(db, "createTable", {name: "Projects"});

        const {tableIds} = run(db, "listTableIds", {});

        expect(tableIds).toEqual([first.tableId, second.tableId]);
        db.close();
    });

    test("returns empty array on a fresh database", async () => {
        const db = await createDb();

        const {tableIds} = run(db, "listTableIds", {});

        expect(tableIds).toEqual([]);
        db.close();
    });

    test("filters out join table ids", async () => {
        const db = await createDb();
        const table = run(db, "createTable", {name: "Tasks"});
        const joinTableId = generateChronologicalId<DatabaseTableId>();

        sql`
            INSERT INTO
                _alpine_tables (id, kind)
            VALUES
                (${joinTableId}, 'join')
        `.exec(db);

        const {tableIds} = run(db, "listTableIds", {});

        expect(tableIds).toEqual([table.tableId]);
        db.close();
    });
});

describe("listTables", () => {
    test("returns user table ids and display names in id order", async () => {
        const db = await createDb();
        const first = run(db, "createTable", {name: "Tasks"});
        const second = run(db, "createTable", {name: "Projects"});
        const relation = run(db, "createRelationField", {
            tableId: first.tableId,
            viewId: first.viewId,
            name: "Project",
            linkedTableId: second.tableId,
            cardinality: "many",
        });

        const {tables} = run(db, "listTables", {});

        expect(tables).toEqual([
            {id: first.tableId, name: "Tasks"},
            {id: second.tableId, name: "Projects"},
        ]);
        expect(tables.map(table => table.id)).not.toContain(relation.joinTableId);
        db.close();
    });
});

describe("createRelationField", () => {
    test("creates the join table row, source field, and symmetric target field", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const target = run(db, "createTable", {name: "Projects"});
        const targetSecondViewId = generateChronologicalId<DatabaseViewId>();
        sql`
            INSERT INTO
                ${sql.tableRef(target.tableId, "_alpine_views")} (id, table_id, name)
            VALUES
                (
                    ${targetSecondViewId},
                    ${target.tableId},
                    'Other view'
                )
        `.exec(db);

        const result = run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "one",
        });

        const registryRow = sql`
            SELECT
                *
            FROM
                _alpine_tables
            WHERE
                id = ${result.joinTableId}
        `.selectAllUnknown(db)[0];
        const joinRow = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(result.joinTableId, "_alpine_join_table")}
        `.selectAllUnknown(db)[0];
        const sourceField = readFieldById(db, source.tableId, result.sourceFieldId);
        const targetField = readFieldById(db, target.tableId, result.targetFieldId);
        const targetViewFieldIds = sql`
            SELECT
                field_id
            FROM
                ${sql.tableRef(target.tableId, "_alpine_view_fields")}
            WHERE
                field_id = ${result.targetFieldId}
            ORDER BY
                view_id
        `
            .selectAll(db, {
                fieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("field_id"),
            })
            .map(viewField => viewField.fieldId);

        expect({
            registryRow,
            joinRow,
            sourceField,
            targetField,
            targetViewFieldIds,
        }).toMatchObject({
            registryRow: {id: result.joinTableId, kind: "join"},
            joinRow: {
                id: result.joinTableId,
                source_table_id: source.tableId,
                source_field_id: result.sourceFieldId,
                target_table_id: target.tableId,
                target_field_id: result.targetFieldId,
            },
            sourceField: {
                name: "Project",
                config: {
                    type: "relation",
                    joinTableId: result.joinTableId,
                    side: "source",
                    cardinality: "one",
                    linkedTableId: target.tableId,
                },
            },
            targetField: {
                name: "Tasks",
                config: {
                    type: "relation",
                    joinTableId: result.joinTableId,
                    side: "target",
                    cardinality: "many",
                    linkedTableId: source.tableId,
                },
            },
            targetViewFieldIds: [result.targetFieldId, result.targetFieldId],
        });
        db.close();
    });

    test("deduplicates the symmetric field name against target fields", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Name"});
        const target = run(db, "createTable", {name: "Projects"});

        const result = run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "many",
        });

        const targetField = readFieldById(db, target.tableId, result.targetFieldId);
        expect(targetField.name).toBe("Name 2");
        db.close();
    });

    test("supports self-links", async () => {
        const db = await createDb();
        const table = run(db, "createTable", {name: "Tasks"});

        const result = run(db, "createRelationField", {
            tableId: table.tableId,
            viewId: table.viewId,
            name: "Related",
            linkedTableId: table.tableId,
            cardinality: "many",
        });

        const fields = sql`
            SELECT
                id,
                name,
                config
            FROM
                ${sql.tableRef(table.tableId, "_alpine_fields")}
            WHERE
                id IN (
                    ${result.sourceFieldId},
                    ${result.targetFieldId}
                )
            ORDER BY
                name
        `.selectAll(db, {
            id: Schema.id<DatabaseFieldId>(),
            name: Schema.string,
            config: DatabaseFieldConfigSqlSchema,
        });
        expect(fields).toMatchObject([
            {id: result.sourceFieldId, name: "Related", config: {side: "source"}},
            {id: result.targetFieldId, name: "Tasks", config: {side: "target"}},
        ]);
        db.close();
    });

    test("rejects unknown linked tables", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const linkedTableId = generateChronologicalId<DatabaseTableId>();

        expect(() =>
            run(db, "createRelationField", {
                tableId: source.tableId,
                viewId: source.viewId,
                name: "Missing",
                linkedTableId,
                cardinality: "many",
            }),
        ).toThrow("linked table not found");
        db.close();
    });

    test("rejects join tables as linked targets", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const linkedTableId = generateChronologicalId<DatabaseTableId>();
        sql`
            INSERT INTO
                _alpine_tables (id, kind)
            VALUES
                (${linkedTableId}, 'join')
        `.exec(db);

        expect(() =>
            run(db, "createRelationField", {
                tableId: source.tableId,
                viewId: source.viewId,
                name: "Join",
                linkedTableId,
                cardinality: "many",
            }),
        ).toThrow("linked table not found");
        db.close();
    });
});

describe("addLink", () => {
    test("inserts a link row and ignores duplicate adds", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const target = run(db, "createTable", {name: "Projects"});
        const relation = run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const targetRowId = createRowAndGetId(db, target.tableId);

        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: targetRowId,
        });
        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: targetRowId,
        });

        expect(readLinks(db, relation.joinTableId)).toEqual([{sourceRowId, targetRowId}]);
        db.close();
    });

    test("replaces other links for one-cardinality fields", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const target = run(db, "createTable", {name: "Projects"});
        const relation = run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "one",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const firstTargetRowId = createRowAndGetId(db, target.tableId);
        const secondTargetRowId = createRowAndGetId(db, target.tableId);

        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: firstTargetRowId,
        });
        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: secondTargetRowId,
        });
        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: secondTargetRowId,
        });

        expect(readLinks(db, relation.joinTableId)).toEqual([
            {sourceRowId, targetRowId: secondTargetRowId},
        ]);
        db.close();
    });

    test("maps symmetric target fields back to source and target columns", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const target = run(db, "createTable", {name: "Projects"});
        const relation = run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const targetRowId = createRowAndGetId(db, target.tableId);

        run(db, "addLink", {
            tableId: target.tableId,
            fieldId: relation.targetFieldId,
            rowId: targetRowId,
            linkedRowId: sourceRowId,
        });

        expect(readLinks(db, relation.joinTableId)).toEqual([{sourceRowId, targetRowId}]);
        db.close();
    });

    test("validates the linked row before replacing an existing one-cardinality link", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const target = run(db, "createTable", {name: "Projects"});
        const relation = run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "one",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const targetRowId = createRowAndGetId(db, target.tableId);
        const missingTargetRowId = generateChronologicalId<DatabaseRowId>();

        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: targetRowId,
        });

        expect(() =>
            run(db, "addLink", {
                tableId: source.tableId,
                fieldId: relation.sourceFieldId,
                rowId: sourceRowId,
                linkedRowId: missingTargetRowId,
            }),
        ).toThrow("linked row not found");
        expect(readLinks(db, relation.joinTableId)).toEqual([{sourceRowId, targetRowId}]);
        db.close();
    });

    test("rejects non-relation fields", async () => {
        const db = await createDb();
        const table = run(db, "createTable", {name: "Tasks"});
        const fieldId = readNameFieldId(db, table.tableId);
        const rowId = createRowAndGetId(db, table.tableId);
        const linkedRowId = createRowAndGetId(db, table.tableId);

        expect(() =>
            run(db, "addLink", {
                tableId: table.tableId,
                fieldId,
                rowId,
                linkedRowId,
            }),
        ).toThrow("field is not a relation field");
        db.close();
    });
});

describe("removeLink", () => {
    test("deletes one matching link and ignores missing links", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const target = run(db, "createTable", {name: "Projects"});
        const relation = run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const firstTargetRowId = createRowAndGetId(db, target.tableId);
        const secondTargetRowId = createRowAndGetId(db, target.tableId);

        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: firstTargetRowId,
        });
        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: secondTargetRowId,
        });

        run(db, "removeLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: firstTargetRowId,
        });
        run(db, "removeLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: firstTargetRowId,
        });

        expect(readLinks(db, relation.joinTableId)).toEqual([
            {sourceRowId, targetRowId: secondTargetRowId},
        ]);
        db.close();
    });

    test("removes self-links through the target-side field", async () => {
        const db = await createDb();
        const table = run(db, "createTable", {name: "Tasks"});
        const relation = run(db, "createRelationField", {
            tableId: table.tableId,
            viewId: table.viewId,
            name: "Related",
            linkedTableId: table.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, table.tableId);
        const targetRowId = createRowAndGetId(db, table.tableId);

        run(db, "addLink", {
            tableId: table.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: targetRowId,
        });
        run(db, "removeLink", {
            tableId: table.tableId,
            fieldId: relation.targetFieldId,
            rowId: targetRowId,
            linkedRowId: sourceRowId,
        });

        expect(readLinks(db, relation.joinTableId)).toEqual([]);
        db.close();
    });
});

describe("listLinkableRows", () => {
    test("returns linked-table rows excluding rows already linked to the edited row", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const target = run(db, "createTable", {name: "Projects"});
        const relation = run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const firstTargetRowId = createRowAndGetId(db, target.tableId);
        const secondTargetRowId = createRowAndGetId(db, target.tableId);
        const targetNameFieldId = readNameFieldId(db, target.tableId);
        run(db, "updateCellValue", {
            tableId: target.tableId,
            fieldId: targetNameFieldId,
            rowId: firstTargetRowId,
            value: "Alpha",
        });
        run(db, "updateCellValue", {
            tableId: target.tableId,
            fieldId: targetNameFieldId,
            rowId: secondTargetRowId,
            value: "Beta",
        });
        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: firstTargetRowId,
        });

        const {rows} = run(db, "listLinkableRows", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
        });

        expect(rows).toEqual([{id: secondTargetRowId, name: "Beta"}]);
        db.close();
    });

    test("maps target-side fields back to source-table candidates", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const target = run(db, "createTable", {name: "Projects"});
        const relation = run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const targetRowId = createRowAndGetId(db, target.tableId);
        run(db, "updateCellValue", {
            tableId: source.tableId,
            fieldId: readNameFieldId(db, source.tableId),
            rowId: sourceRowId,
            value: "Write tests",
        });

        const {rows} = run(db, "listLinkableRows", {
            tableId: target.tableId,
            fieldId: relation.targetFieldId,
            rowId: targetRowId,
        });

        expect(rows).toEqual([{id: sourceRowId, name: "Write tests"}]);
        db.close();
    });
});

describe("renameTable", () => {
    test("relabels without changing tableName when slug is unchanged", async () => {
        const db = await createDb();
        const {tableId, tableName: original} = run(db, "createTable", {name: "Tasks"});

        // "Tasks" and "Tasks!" both slugify to "tasks", so the SQL table name should not
        // change — only the label.
        const {tableName} = run(db, "renameTable", {tableId, name: "Tasks!"});

        expect(tableName).toBe(original);
        const rows = sql`
            SELECT
                name,
                table_name
            FROM
                ${sql.tableRef(tableId, "_alpine_table")}
        `.selectAllUnknown(db);
        expect(rows).toMatchObject([{name: "Tasks!", table_name: original}]);
        db.close();
    });

    test("renames the SQL table when the slug changes and keeps the index", async () => {
        const db = await createDb();
        const {tableId} = run(db, "createTable", {name: "Tasks"});
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, "tasks")} (name)
            VALUES
                ('keep me')
        `.exec(db);

        const {tableName} = run(db, "renameTable", {tableId, name: "Projects"});

        expect(tableName).toBe("projects");
        // Data survives the rename.
        const rows = sql`
            SELECT
                name
            FROM
                ${sql.tableRef(tableId, "projects")}
        `.selectAllUnknown(db);
        expect(rows).toMatchObject([{name: "keep me"}]);
        // The created_at index follows the rename.
        const indexes = sql`
            PRAGMA ${sql.tableRef(tableId, "index_list")} (${sql.identifier("projects")})
        `.selectAllUnknown(db);
        expect(indexes.some(idx => (idx.name as string).includes("_created_at"))).toBe(true);
        db.close();
    });

    test("rename within its own file does not add a dedup suffix", async () => {
        const db = await createDb();
        // A separate table named "Tasks" lives in its own file, so it does not collide
        // with this rename.
        run(db, "createTable", {name: "Tasks"});
        const {tableId} = run(db, "createTable", {name: "Projects"});

        const {tableName} = run(db, "renameTable", {tableId, name: "Tasks"});

        expect(tableName).toBe("tasks");
        db.close();
    });
});

describe("getViewRowsPageCursor", () => {
    test("returns null endCursor when fewer rows than limit exist", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = run(db, "createTable", {name: "T"});
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (name)
            VALUES
                ('a'),
                ('b')
        `.exec(db);

        const result = run(db, "getViewRowsPageCursor", {
            tableOrViewId: viewId,
            afterCursor: null,
            limit: 5,
        });

        expect(result).toMatchObject({tableId, viewId, tableName, endCursor: null});
    });

    test("returns endCursor when row count equals limit", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = run(db, "createTable", {name: "T"});
        const ids: Array<string> = [];
        for (let i = 0; i < 3; i++) {
            const id = generateChronologicalId<DatabaseRowId>();
            ids.push(id);
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, tableName)} (_id, name)
                VALUES
                    (
                        ${id},
                        ${`row-${i}`}
                    )
            `.exec(db);
        }

        const result = run(db, "getViewRowsPageCursor", {
            tableOrViewId: viewId,
            afterCursor: null,
            limit: 3,
        });

        // Last id since we inserted in order.
        expect(result.endCursor).toBe(ids[ids.length - 1]);
    });

    test("after-cursor pagination skips earlier rows", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = run(db, "createTable", {name: "T"});
        const ids: Array<DatabaseRowId> = [];
        for (let i = 0; i < 5; i++) {
            const id = generateChronologicalId<DatabaseRowId>();
            ids.push(id);
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, tableName)} (_id)
                VALUES
                    (${id})
            `.exec(db);
        }

        const result = run(db, "getViewRowsPageCursor", {
            tableOrViewId: viewId,
            afterCursor: ids[1]!,
            limit: 2,
        });

        // Rows 2 and 3 fit, row 3's id is the cursor.
        expect(result.endCursor).toBe(ids[3]);
    });
});

describe("getViewRowsPage", () => {
    test("returns rows in id order with _id at position 0 and view fields at positions 1..n", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = run(db, "createTable", {name: "T"});
        const id1 = generateChronologicalId<DatabaseRowId>();
        const id2 = generateChronologicalId<DatabaseRowId>();
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (_id, name)
            VALUES
                (
                    ${id1},
                    ${"alpha"}
                )
        `.exec(db);
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (_id, name)
            VALUES
                (
                    ${id2},
                    ${"beta"}
                )
        `.exec(db);

        const {fieldIndexes, rows} = run(db, "getViewRowsPage", {
            tableOrViewId: viewId,
            afterCursor: null,
            endCursor: null,
        });

        expect(fieldIndexes.size).toBe(1);
        const nameIndex = [...fieldIndexes.values()][0]!;
        expect(nameIndex).toBe(1);
        expect(rows).toEqual([
            [id1, "alpha"],
            [id2, "beta"],
        ]);
    });

    test("filters by both afterCursor and endCursor when both are set", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = run(db, "createTable", {name: "T"});
        const ids: Array<DatabaseRowId> = [];
        for (let i = 0; i < 4; i++) {
            const id = generateChronologicalId<DatabaseRowId>();
            ids.push(id);
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, tableName)} (_id)
                VALUES
                    (${id})
            `.exec(db);
        }

        const {rows} = run(db, "getViewRowsPage", {
            tableOrViewId: viewId,
            afterCursor: ids[0]!,
            endCursor: ids[2]!,
        });

        expect(rows.map(r => r[0])).toEqual([ids[1], ids[2]]);
    });

    test("after-only and end-only cursor branches return the expected slices", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = run(db, "createTable", {name: "T"});
        const ids: Array<DatabaseRowId> = [];
        for (let i = 0; i < 3; i++) {
            const id = generateChronologicalId<DatabaseRowId>();
            ids.push(id);
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, tableName)} (_id)
                VALUES
                    (${id})
            `.exec(db);
        }

        const afterOnly = run(db, "getViewRowsPage", {
            tableOrViewId: viewId,
            afterCursor: ids[0]!,
            endCursor: null,
        });
        expect(afterOnly.rows.map(r => r[0])).toEqual([ids[1], ids[2]]);

        const endOnly = run(db, "getViewRowsPage", {
            tableOrViewId: viewId,
            afterCursor: null,
            endCursor: ids[1]!,
        });
        expect(endOnly.rows.map(r => r[0])).toEqual([ids[0], ids[1]]);
    });

    test("checkbox values are deserialized via the field provider's sqlValueSchema", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = run(db, "createTable", {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Done", "checkbox");
        const rowId = generateChronologicalId<DatabaseRowId>();
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (_id)
            VALUES
                (${rowId})
        `.exec(db);
        run(db, "updateCellValue", {tableId, fieldId, rowId, value: true});

        const {fieldIndexes, rows} = run(db, "getViewRowsPage", {
            tableOrViewId: viewId,
            afterCursor: null,
            endCursor: null,
        });

        const checkboxIndex = fieldIndexes.get(fieldId)!;
        expect(rows[0]![checkboxIndex]).toBe(true);
    });

    test("projects relation fields as ordered arrays and empty cells as empty arrays", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const target = run(db, "createTable", {name: "Projects"});
        const relation = run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "many",
        });
        const firstSourceRowId = createRowAndGetId(db, source.tableId);
        const secondSourceRowId = createRowAndGetId(db, source.tableId);
        const firstTargetRowId = createRowAndGetId(db, target.tableId);
        const secondTargetRowId = createRowAndGetId(db, target.tableId);
        const targetNameFieldId = readNameFieldId(db, target.tableId);
        run(db, "updateCellValue", {
            tableId: target.tableId,
            fieldId: targetNameFieldId,
            rowId: firstTargetRowId,
            value: "Alpha",
        });
        run(db, "updateCellValue", {
            tableId: target.tableId,
            fieldId: targetNameFieldId,
            rowId: secondTargetRowId,
            value: "Beta",
        });
        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: firstSourceRowId,
            linkedRowId: firstTargetRowId,
        });
        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: firstSourceRowId,
            linkedRowId: secondTargetRowId,
        });

        const {fieldIndexes, rows} = run(db, "getViewRowsPage", {
            tableOrViewId: source.viewId,
            afterCursor: null,
            endCursor: null,
        });

        const relationIndex = fieldIndexes.get(relation.sourceFieldId)!;
        expect(rows.map(row => ({id: row[0], links: row[relationIndex]}))).toEqual([
            {
                id: firstSourceRowId,
                links: [
                    {id: firstTargetRowId, name: "Alpha"},
                    {id: secondTargetRowId, name: "Beta"},
                ],
            },
            {id: secondSourceRowId, links: []},
        ]);
        db.close();
    });

    test("formats relation names through the linked table name-field provider", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const target = run(db, "createTable", {name: "Projects"});
        const {fieldId: scoreFieldId} = addFieldAndGetId(
            db,
            target.tableId,
            target.viewId,
            "Score",
            "number",
        );
        sql`
            UPDATE ${sql.tableRef(target.tableId, "_alpine_table")}
            SET
                name_field_id = ${scoreFieldId}
        `.exec(db);
        sql`
            UPDATE ${sql.tableRef(target.tableId, "_alpine_fields")}
            SET
                config = ${DatabaseFieldConfigSqlSchema.serialize({
                type: "number",
                decimalPlaces: 2,
            })}
            WHERE
                id = ${scoreFieldId}
        `.exec(db);
        const relation = run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const targetRowId = createRowAndGetId(db, target.tableId);
        run(db, "updateCellValue", {
            tableId: target.tableId,
            fieldId: scoreFieldId,
            rowId: targetRowId,
            value: 3.14159,
        });
        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: targetRowId,
        });

        const {fieldIndexes, rows} = run(db, "getViewRowsPage", {
            tableOrViewId: source.viewId,
            afterCursor: null,
            endCursor: null,
        });

        expect(rows[0]![fieldIndexes.get(relation.sourceFieldId)!]).toEqual([
            {id: targetRowId, name: "3.14"},
        ]);
        db.close();
    });

    test("keeps cursor slicing unchanged when projecting relation fields", async () => {
        const db = await createDb();
        const source = run(db, "createTable", {name: "Tasks"});
        const target = run(db, "createTable", {name: "Projects"});
        run(db, "createRelationField", {
            tableId: source.tableId,
            viewId: source.viewId,
            name: "Project",
            linkedTableId: target.tableId,
            cardinality: "many",
        });
        const ids = [
            createRowAndGetId(db, source.tableId),
            createRowAndGetId(db, source.tableId),
            createRowAndGetId(db, source.tableId),
        ];

        const {rows} = run(db, "getViewRowsPage", {
            tableOrViewId: source.viewId,
            afterCursor: ids[0]!,
            endCursor: ids[1]!,
        });

        expect(rows.map(row => row[0])).toEqual([ids[1]]);
        db.close();
    });

    test("projects both directions of a self-link relation", async () => {
        const db = await createDb();
        const table = run(db, "createTable", {name: "Tasks"});
        const relation = run(db, "createRelationField", {
            tableId: table.tableId,
            viewId: table.viewId,
            name: "Related",
            linkedTableId: table.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, table.tableId);
        const targetRowId = createRowAndGetId(db, table.tableId);
        const nameFieldId = readNameFieldId(db, table.tableId);
        run(db, "updateCellValue", {
            tableId: table.tableId,
            fieldId: nameFieldId,
            rowId: sourceRowId,
            value: "Parent",
        });
        run(db, "updateCellValue", {
            tableId: table.tableId,
            fieldId: nameFieldId,
            rowId: targetRowId,
            value: "Child",
        });
        run(db, "addLink", {
            tableId: table.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: targetRowId,
        });

        const {fieldIndexes, rows} = run(db, "getViewRowsPage", {
            tableOrViewId: table.viewId,
            afterCursor: null,
            endCursor: null,
        });

        expect(
            rows.map(row => ({
                id: row[0],
                sourceLinks: row[fieldIndexes.get(relation.sourceFieldId)!],
                targetLinks: row[fieldIndexes.get(relation.targetFieldId)!],
            })),
        ).toEqual([
            {
                id: sourceRowId,
                sourceLinks: [{id: targetRowId, name: "Child"}],
                targetLinks: [],
            },
            {
                id: targetRowId,
                sourceLinks: [],
                targetLinks: [{id: sourceRowId, name: "Parent"}],
            },
        ]);
        db.close();
    });
});

describe("updateCellValue", () => {
    test("writes the value to the table after serializing through the provider", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = run(db, "createTable", {name: "T"});
        const {fieldId: nameFieldId} = sql`
            SELECT
                id
            FROM
                ${sql.tableRef(tableId, "_alpine_fields")}
            WHERE
                table_id = ${tableId}
        `.selectOne(db, {
            fieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("id"),
        });
        const rowId = generateChronologicalId<DatabaseRowId>();
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (_id)
            VALUES
                (${rowId})
        `.exec(db);

        run(db, "updateCellValue", {
            tableId,
            fieldId: nameFieldId,
            rowId,
            value: "updated",
        });

        // Use the view to confirm the value flows through serialize and deserialize
        // correctly.
        const {fieldIndexes, rows} = run(db, "getViewRowsPage", {
            tableOrViewId: viewId,
            afterCursor: null,
            endCursor: null,
        });
        expect(rows[0]![fieldIndexes.get(nameFieldId)!]).toBe("updated");
        db.close();
    });

    test("rejects virtual fields", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = run(db, "createTable", {name: "T"});
        const {fieldId} = addRelationFieldMetadata(db, tableId, viewId);
        const rowId = generateChronologicalId<DatabaseRowId>();
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (_id)
            VALUES
                (${rowId})
        `.exec(db);

        expect(() => {
            run(db, "updateCellValue", {
                tableId,
                fieldId,
                rowId,
                value: [],
            });
        }).toThrow("cannot update virtual field");
        db.close();
    });
});

describe("createField", () => {
    test("rejects relation fields", async () => {
        const db = await createDb();
        const {tableId, viewId} = run(db, "createTable", {name: "T"});
        const fieldId = generateChronologicalId<DatabaseFieldId>();

        expect(() => {
            run(db, "createField", {
                fieldId,
                tableId,
                viewId,
                name: "Links",
                type: "relation",
            });
        }).toThrow("use createRelationField");
        db.close();
    });
});

describe("updateFieldConfig", () => {
    test("rejects relation linkedTableId changes", async () => {
        const db = await createDb();
        const fieldId = generateChronologicalId<DatabaseFieldId>();
        const config = {
            type: "relation" as const,
            joinTableId: generateChronologicalId<DatabaseTableId>(),
            side: "source" as const,
            cardinality: "many" as const,
            linkedTableId: generateChronologicalId<DatabaseTableId>(),
        };
        sql`
            CREATE TEMP TABLE _alpine_fields (id TEXT PRIMARY KEY, config TEXT NOT NULL) STRICT
        `.exec(db);
        sql`
            INSERT INTO
                _alpine_fields (id, config)
            VALUES
                (
                    ${fieldId},
                    ${DatabaseFieldConfigSqlSchema.serialize(config)}
                )
        `.exec(db);

        expect(() => {
            run(db, "updateFieldConfig", {
                fieldId,
                config: {
                    ...config,
                    linkedTableId: generateChronologicalId<DatabaseTableId>(),
                },
            });
        }).toThrow("cannot update relation field linkedTableId");
        db.close();
    });
});

describe("createRow", () => {
    test("inserts a row with the given _id and uses column defaults for the rest", async () => {
        const db = await createDb();
        const {tableId, tableName} = run(db, "createTable", {name: "T"});
        const rowId = generateChronologicalId<DatabaseRowId>();

        run(db, "createRow", {tableId, rowId});

        const rows = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(tableId, tableName)}
        `.selectAllUnknown(db);
        expect(rows).toMatchObject([{_id: rowId, name: ""}]);
        expect(rows[0]!._created_at).toBeDefined();
        db.close();
    });
});

describe("resizeField", () => {
    test("updates only the width of the targeted view+field row", async () => {
        const db = await createDb();
        const {tableId, viewId} = run(db, "createTable", {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        run(db, "resizeField", {tableId, viewId, fieldId, width: 321});

        const row = sql`
            SELECT
                width
            FROM
                ${sql.tableRef(tableId, "_alpine_view_fields")}
            WHERE
                view_id = ${viewId}
                AND field_id = ${fieldId}
        `.selectOne(db, {width: Schema.integer});
        expect(row.width).toBe(321);
        db.close();
    });
});

describe("renameField", () => {
    test("renames both the metadata row and the underlying SQL column", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = run(db, "createTable", {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        run(db, "renameField", {tableId, fieldId, name: "Priority"});

        const meta = sql`
            SELECT
                name,
                column_name
            FROM
                ${sql.tableRef(tableId, "_alpine_fields")}
            WHERE
                id = ${fieldId}
        `.selectOne(db, {
            name: Schema.string,
            columnName: Schema.string.originalPropertyKey("column_name"),
        });
        expect(meta).toMatchObject({name: "Priority", columnName: "priority"});

        // Ensure the SQL column was renamed by querying it (would throw if the column
        // didn't exist).
        sql`
            SELECT
                priority
            FROM
                ${sql.tableRef(tableId, tableName)}
        `.selectAllUnknown(db);
        db.close();
    });

    test("dedups against existing column names but excludes the field being renamed", async () => {
        const db = await createDb();
        const {tableId, viewId} = run(db, "createTable", {name: "T"});
        const {fieldId: statusId} = addFieldAndGetId(db, tableId, viewId, "Status");
        addFieldAndGetId(db, tableId, viewId, "Priority");

        // Rename Status → Priority. The "priority" column is taken by the other field, so
        // a suffix should be added.
        run(db, "renameField", {tableId, fieldId: statusId, name: "Priority"});

        const meta = sql`
            SELECT
                column_name
            FROM
                ${sql.tableRef(tableId, "_alpine_fields")}
            WHERE
                id = ${statusId}
        `.selectOne(db, {columnName: Schema.string.originalPropertyKey("column_name")});
        expect(meta.columnName).toBe("priority_2");
        db.close();
    });

    test("can rename to a label whose slug equals the existing column (idempotent)", async () => {
        const db = await createDb();
        const {tableId, viewId} = run(db, "createTable", {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        // The existing field's column is "status"; renaming to "Status!" still slugifies
        // to "status" — but the dedup loop excludes the field being renamed
        // (`AND id != ${fieldId}`) so no suffix is added.
        run(db, "renameField", {tableId, fieldId, name: "Status!"});

        const meta = sql`
            SELECT
                column_name
            FROM
                ${sql.tableRef(tableId, "_alpine_fields")}
            WHERE
                id = ${fieldId}
        `.selectOne(db, {columnName: Schema.string.originalPropertyKey("column_name")});
        expect(meta.columnName).toBe("status");
        db.close();
    });

    test("renames virtual field metadata without altering the data table", async () => {
        const db = await createDb();
        const {tableId, viewId} = run(db, "createTable", {name: "T"});
        const {fieldId} = addRelationFieldMetadata(db, tableId, viewId);

        run(db, "renameField", {tableId, fieldId, name: "Partners"});

        const meta = sql`
            SELECT
                name,
                column_name
            FROM
                ${sql.tableRef(tableId, "_alpine_fields")}
            WHERE
                id = ${fieldId}
        `.selectOne(db, {
            name: Schema.string,
            columnName: Schema.string.originalPropertyKey("column_name"),
        });
        expect(meta).toMatchObject({name: "Partners", columnName: "partners"});
        db.close();
    });
});
