import sqlite3InitModule, {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {allowAllTableAccess} from "~/shared/databases/allow_all_table_access.js";
import type {DatabaseActionContext} from "~/shared/databases/database_action_context.js";
import {
    type DatabaseActionInput,
    type DatabaseActionName,
    type DatabaseActionOutput,
    createDatabaseActionContext,
    executeDatabaseAction,
} from "~/shared/databases/database_actions.js";
import {databaseTableAccessPolicyForCreator} from "~/shared/databases/database_table_access_policy.js";
import {
    type DatabaseFieldConfig,
    DatabaseFieldConfigSqlSchema,
} from "~/shared/databases/fields/database_field_config.js";
import {DatabaseModel} from "~/shared/databases/model/database_root_model.js";
import {databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {runMainMigrations} from "~/shared/databases/sqlite_migrations.js";
import {InMemoryDatabaseServerTableStore} from "~/shared/databases/test_helpers/in_memory_database_server_table_store.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {
    type OrderKey,
    generateOrderKeyBetween,
} from "~/shared/helpers/sort/order_key.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId, isId} from "~/shared/id/id.open_source.js";
import type {
    AccountId,
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;
const testAccountId = generateId<AccountId>();

async function createDb(): Promise<SqliteDatabase> {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-actions-${dbCounter++}.sqlite3`, "ct");
    registerSqliteCustomFunctions(sqlite3, db);
    runMainMigrations(db);
    return db;
}

function attachTableDb(db: SqliteDatabase, tableId: DatabaseTableId): void {
    sql` ATTACH DATABASE ':memory:' AS ${sql.identifier(databaseTableSchemaName(tableId))} `.exec(
        db,
    );
}

// One table store per test handle: the store carries the name-uniqueness state
// across the multiple actions a test runs against the same db.
const tableStores = new WeakMap<SqliteDatabase, InMemoryDatabaseServerTableStore>();

/**
 * Action context for the raw test handle. There's no VFS here, so a table's per-db
 * file is simulated with an in-memory attached database under the table id's
 * schema.
 */
function makeCtx(db: SqliteDatabase): DatabaseActionContext {
    let tables = tableStores.get(db);
    if (tables === undefined) {
        tables = new InMemoryDatabaseServerTableStore();
        tableStores.set(db, tables);
    }
    return createDatabaseActionContext(
        db,
        {
            attach(tableId) {
                attachTableDb(db, tableId);
            },
            getCurrentAccountId() {
                return testAccountId;
            },
            tables,
        },
        allowAllTableAccess,
    );
}

/** Run an action with a freshly-built context. */
function run<N extends DatabaseActionName>(
    db: Database,
    name: N,
    input: DatabaseActionInput<N>,
): DatabaseActionOutput<N> {
    return executeDatabaseAction<N>({name, input} as any, makeCtx(db));
}

function createTableForTest(db: Database, name: string): DatabaseActionOutput<"createTable"> {
    return run(db, "createTable", {
        tableId: generateId<DatabaseTableId>(),
        name,
        accessPolicy: databaseTableAccessPolicyForCreator(testAccountId),
        policyRevision: {tableMetadataVersion: 1, sourcePolicyVersion: 0},
    });
}

describe("createTable", () => {
    test("registers an id-only row in the main database", async () => {
        const db = await createDb();
        const {tableId, tableName} = createTableForTest(db, "Tasks");

        expect(isId(tableId)).toBe(true);
        expect(tableName).toBe("tasks");

        // The public main database holds only ids and storage kind — no name.
        const tables = sql`
            SELECT
                *
            FROM
                _alpine_tables
        `.selectAllUnknown(db);
        expect(tables).toEqual([
            {
                id: tableId,
                kind: "table",
            },
        ]);
        db.close();
    });

    test("stores the table name and identifier in its per-db file", async () => {
        const db = await createDb();
        const {tableId} = createTableForTest(db, "Tasks");

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
        const {tableId} = createTableForTest(db, "Tasks");

        const fields = sql`
            SELECT
                id,
                name,
                column_name,
                JSON(config) AS config
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
        const {tableId, tableName} = createTableForTest(db, "Tasks");

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
        const {tableId, tableName} = createTableForTest(db, "T");

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
        const {tableId, tableName} = createTableForTest(db, "T");

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
        const {tableId, tableName} = createTableForTest(db, "T");

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
        const {tableId, tableName} = createTableForTest(db, "T");

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
        const {tableId, tableName} = createTableForTest(db, "T");

        expect(() => {
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, tableName)} (name)
                VALUES
                    (x'00')
            `.exec(db);
        }).toThrow("CHECK");
    });

    test("column type is encoded in type name", async () => {
        const db = await createDb();
        const {tableId, tableName} = createTableForTest(db, "T");

        const colInfo = sql`
            PRAGMA ${sql.tableRef(tableId, "table_info")} (${sql.identifier(tableName)})
        `.selectAllUnknown(db);

        const nameCol = colInfo.find(c => c.name === "name");
        expect(nameCol!.type).toMatch(/^_alpine_TEXT_[0-9a-z]{26}_[0-9a-z]{26}$/);
    });

    test("duplicate table names get unique SQL identifiers", async () => {
        const db = await createDb();
        const first = createTableForTest(db, "Tasks");
        const second = createTableForTest(db, "Tasks");

        expect(first.tableName).toBe("tasks");
        expect(second.tableName).toBe("tasks_2");
    });

    test("index exists on _created_at", async () => {
        const db = await createDb();
        const {tableId, tableName} = createTableForTest(db, "T");

        const indexes = sql`
            PRAGMA ${sql.tableRef(tableId, "index_list")} (${sql.identifier(tableName)})
        `.selectAllUnknown(db);

        expect(indexes.some(idx => (idx.name as string).includes("_created_at"))).toBe(true);
        db.close();
    });

    test("creates a default view in the per-db file", async () => {
        const db = await createDb();
        const {tableId, viewId} = createTableForTest(db, "Tasks");

        const views = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(tableId, "_alpine_views")}
        `.selectAllUnknown(db);

        expect(views).toMatchObject([{id: viewId, name: "Grid view"}]);
        db.close();
    });

    test("records the view in the main routing index", async () => {
        const db = await createDb();
        const {tableId, viewId} = createTableForTest(db, "Tasks");

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
        const {viewId} = createTableForTest(db, "Tasks");

        expect(isId(viewId)).toBe(true);
        db.close();
    });

    test("default view contains the Name field", async () => {
        const db = await createDb();
        const {tableId, viewId} = createTableForTest(db, "Tasks");

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
        const {viewId} = createTableForTest(db, "T");
        const result = run(db, "getViewSchema", {tableOrViewId: viewId});

        expect(result.fields).toHaveLength(1);
        expect(typeof result.fields[0]!.position).toBe("string");
        expect(result.fields[0]!.hidden).toBe(false);
        db.close();
    });

    test("hidden field is included with hidden=true", async () => {
        const db = await createDb();
        const {tableId, viewId} = createTableForTest(db, "T");

        const {fieldId: secondFieldId} = addFieldAndGetId(db, tableId, viewId, "Status");
        run(db, "updateFieldViewVisibility", {
            tableId,
            viewId,
            fieldId: secondFieldId,
            position: "a1" as OrderKey,
            isVisible: false,
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
        const {tableId, viewId} = createTableForTest(db, "T");
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        run(db, "updateFieldViewVisibility", {
            tableId,
            viewId,
            fieldId,
            position: "a1" as OrderKey,
            isVisible: false,
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
        expect(row).toMatchObject([{position: "a1", is_visible: 0}]);
        db.close();
    });

    test("can toggle back to visible", async () => {
        const db = await createDb();
        const {tableId, viewId} = createTableForTest(db, "T");
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        run(db, "updateFieldViewVisibility", {
            tableId,
            viewId,
            fieldId,
            position: "a1" as OrderKey,
            isVisible: false,
        });
        run(db, "updateFieldViewVisibility", {
            tableId,
            viewId,
            fieldId,
            position: "a2" as OrderKey,
            isVisible: true,
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
        expect(row).toMatchObject([{position: "a2", is_visible: 1}]);
        db.close();
    });
});

/** Helper: creates a field via the action and returns its id. */
function addFieldAndGetId(
    db: SqliteDatabase,
    tableId: DatabaseTableId,
    viewId: DatabaseViewId,
    name: string,
    type: "plainText" | "checkbox" | "number" = "plainText",
) {
    const fieldId = generateId<DatabaseFieldId>();
    run(db, "createField", {fieldId, tableId, name, config: getDefaultFieldConfig(type)});
    return {fieldId};
}

function getDefaultFieldConfig(type: "plainText" | "checkbox" | "number") {
    switch (type) {
        case "checkbox":
            return {type: "checkbox" as const};
        case "number":
            return {type: "number" as const, decimalPlaces: null};
        case "plainText":
            return {type: "plainText" as const};
    }
}

function createRowAndGetId(db: SqliteDatabase, tableId: DatabaseTableId): DatabaseRowId {
    const rowId = generateChronologicalId<DatabaseRowId>();
    run(db, "createRow", {tableId, rowId});
    return rowId;
}

function readNameFieldId(db: SqliteDatabase, tableId: DatabaseTableId): DatabaseFieldId {
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
    db: SqliteDatabase,
    tableId: DatabaseTableId,
    viewId: DatabaseViewId,
    name = "Links",
) {
    const fieldId = generateId<DatabaseFieldId>();
    const joinTableId = generateId<DatabaseTableId>();
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
    const position = generateOrderKeyBetween(maxPosition as OrderKey | null, null);
    sql`
        INSERT INTO
            ${sql.tableRef(tableId, "_alpine_fields")} (id, name, column_name, config)
        VALUES
            (
                ${fieldId},
                ${name},
                ${"links"},
                jsonb (${DatabaseFieldConfigSqlSchema.serialize(config)})
            )
    `.exec(db);
    sql`
        INSERT INTO
            ${sql.tableRef(tableId, "_alpine_view_fields")} (view_id, field_id, position, width)
        VALUES
            (
                ${viewId},
                ${fieldId},
                ${position},
                ${databaseViewDefaultColumnWidth}
            )
    `.exec(db);
    return {fieldId, config};
}

function readFieldById(
    db: SqliteDatabase,
    tableId: DatabaseTableId,
    fieldId: DatabaseFieldId,
): {id: DatabaseFieldId; name: string; config: DatabaseFieldConfig} {
    return sql`
        SELECT
            id,
            name,
            JSON(config) AS config
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
    db: SqliteDatabase,
    joinTableId: DatabaseTableId,
): Array<{sourceRowId: DatabaseRowId; targetRowId: DatabaseRowId}> {
    const joinTable = new DatabaseModel(db, null, allowAllTableAccess).getJoinTable(joinTableId);
    return sql`
        SELECT
            ${joinTable.sourceRowIdColumn()} AS source_row_id,
            ${joinTable.targetRowIdColumn()} AS target_row_id
        FROM
            ${joinTable.tableRef}
        ORDER BY
            ${joinTable.sourceRowIdColumn()},
            ${joinTable.targetRowIdColumn()}
    `.selectAll(db, {
        sourceRowId: Schema.id<DatabaseRowId>().originalPropertyKey("source_row_id"),
        targetRowId: Schema.id<DatabaseRowId>().originalPropertyKey("target_row_id"),
    });
}

describe("rawSql", () => {
    test("SELECT passes rows through", async () => {
        const db = await createDb();
        const {tableId, tableName} = createTableForTest(db, "T");
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (name)
            VALUES
                ('a'),
                ('b')
        `.exec(db);

        const {rows} = run(db, "rawSql", {
            sql: sql`
                SELECT
                    name
                FROM
                    ${sql.tableRef(tableId, tableName)}
                ORDER BY
                    name
            `.query,
        });

        expect(rows).toMatchObject([{name: "a"}, {name: "b"}]);
        db.close();
    });

    test("INSERT goes through (writeLevel: data)", async () => {
        const db = await createDb();
        const {tableId, tableName} = createTableForTest(db, "T");

        run(db, "rawSql", {
            sql: sql`
                INSERT INTO
                    ${sql.tableRef(tableId, tableName)} (name)
                VALUES
                    ('inserted')
            `.query,
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
        const {tableId, tableName} = createTableForTest(db, "T");
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, tableName)} (name)
            VALUES
                ('hello')
        `.exec(db);

        const {rows} = run(db, "readonlyRawSql", {
            sql: sql`
                SELECT
                    name
                FROM
                    ${sql.tableRef(tableId, tableName)}
            `.query,
        });

        expect(rows).toMatchObject([{name: "hello"}]);
        db.close();
    });

    test("returns empty array for empty result set", async () => {
        const db = await createDb();
        const {tableId, tableName} = createTableForTest(db, "T");

        const {rows} = run(db, "readonlyRawSql", {
            sql: sql`
                SELECT
                    *
                FROM
                    ${sql.tableRef(tableId, tableName)}
            `.query,
        });

        expect(rows).toEqual([]);
        db.close();
    });
});

describe("listTableIds", () => {
    test("returns table ids in id order", async () => {
        const db = await createDb();
        const first = createTableForTest(db, "Tasks");
        const second = createTableForTest(db, "Projects");

        const {tableIds} = run(db, "listTableIds", {});

        expect(tableIds).toEqual([first.tableId, second.tableId].sort(defaultCompareStrings));
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
        const table = createTableForTest(db, "Tasks");
        const joinTableId = generateId<DatabaseTableId>();

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
        const first = createTableForTest(db, "Tasks");
        const second = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: first.tableId,
            sourceFieldName: "Project",
            targetTableId: second.tableId,
            cardinality: "many",
        });

        const {tables} = run(db, "listTables", {});

        expect(tables).toEqual(
            [
                {id: first.tableId, name: "Tasks"},
                {id: second.tableId, name: "Projects"},
            ].sort((table1, table2) => defaultCompareStrings(table1.id, table2.id)),
        );
        expect(tables.map(table => table.id)).not.toContain(relation.joinTableId);
        db.close();
    });
});

describe("createRelationField", () => {
    test("creates the join table row, source field, and symmetric target field", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const sourceSecondViewId = generateId<DatabaseViewId>();
        sql`
            INSERT INTO
                ${sql.tableRef(source.tableId, "_alpine_views")} (id, name)
            VALUES
                (${sourceSecondViewId}, 'Other view')
        `.exec(db);
        const targetSecondViewId = generateId<DatabaseViewId>();
        sql`
            INSERT INTO
                ${sql.tableRef(target.tableId, "_alpine_views")} (id, name)
            VALUES
                (${targetSecondViewId}, 'Other view')
        `.exec(db);

        const result = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
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
        const joinTableColumns = sql`
            PRAGMA ${sql.tableRef(result.joinTableId, "table_info")} (${sql.identifier(
                joinRow!.table_name as string,
            )})
        `
            .selectAllUnknown(db)
            .map(column => column.name);
        const sourceViewFieldIds = sql`
            SELECT
                field_id
            FROM
                ${sql.tableRef(source.tableId, "_alpine_view_fields")}
            WHERE
                field_id = ${result.sourceFieldId}
            ORDER BY
                view_id
        `
            .selectAll(db, {
                fieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("field_id"),
            })
            .map(viewField => viewField.fieldId);
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
            joinTableColumns,
            sourceViewFieldIds,
            targetViewFieldIds,
        }).toMatchObject({
            registryRow: {
                id: result.joinTableId,
                kind: "join",
            },
            joinRow: {
                id: result.joinTableId,
                table_name: "project_tasks",
                source_table_id: source.tableId,
                source_field_id: result.sourceFieldId,
                target_table_id: target.tableId,
                target_field_id: result.targetFieldId,
                source_row_id_column_name: "tasks_id",
                source_position_column_name: "tasks_position",
                target_row_id_column_name: "projects_id",
                target_position_column_name: "projects_position",
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
            joinTableColumns: ["tasks_id", "projects_id", "tasks_position", "projects_position"],
            sourceViewFieldIds: [result.sourceFieldId, result.sourceFieldId],
            targetViewFieldIds: [result.targetFieldId, result.targetFieldId],
        });
        db.close();
    });

    test("allows duplicated symmetric field display names", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Name");
        const target = createTableForTest(db, "Projects");

        const result = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
            cardinality: "many",
        });

        const targetField = readFieldById(db, target.tableId, result.targetFieldId);
        expect(targetField.name).toBe("Name");
        db.close();
    });

    test("supports self-links", async () => {
        const db = await createDb();
        const table = createTableForTest(db, "Tasks");

        const result = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: table.tableId,
            sourceFieldName: "Related",
            targetTableId: table.tableId,
            cardinality: "many",
        });

        const fields = sql`
            SELECT
                id,
                name,
                JSON(config) AS config
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
});

describe("addLink", () => {
    test("inserts a link row and ignores duplicate adds", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
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
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
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
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
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
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
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
});

describe("removeLink", () => {
    test("deletes one matching link and ignores missing links", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
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
        const table = createTableForTest(db, "Tasks");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: table.tableId,
            sourceFieldName: "Related",
            targetTableId: table.tableId,
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
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
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
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
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

    test("filters candidates by a case-insensitive name substring", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const targetNameFieldId = readNameFieldId(db, target.tableId);
        for (const name of ["Frogger", "Toad", "Frobnicate"]) {
            const targetRowId = createRowAndGetId(db, target.tableId);
            run(db, "updateCellValue", {
                tableId: target.tableId,
                fieldId: targetNameFieldId,
                rowId: targetRowId,
                value: name,
            });
        }

        const {rows} = run(db, "listLinkableRows", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            search: "fro",
        });

        expect(rows.map(row => row.name).sort()).toEqual(["Frobnicate", "Frogger"]);
        db.close();
    });

    test("matches LIKE wildcards in the search literally", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const targetNameFieldId = readNameFieldId(db, target.tableId);
        for (const name of ["50% done", "plain"]) {
            const targetRowId = createRowAndGetId(db, target.tableId);
            run(db, "updateCellValue", {
                tableId: target.tableId,
                fieldId: targetNameFieldId,
                rowId: targetRowId,
                value: name,
            });
        }

        const {rows} = run(db, "listLinkableRows", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            search: "50%",
        });

        expect(rows).toEqual([{id: expect.anything(), name: "50% done"}]);
        db.close();
    });

    test("returns the linked table name for the picker header", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);

        const {linkedTableName} = run(db, "listLinkableRows", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
        });

        expect(linkedTableName).toBe("Projects");
        db.close();
    });
});

describe("listLinkedRows", () => {
    test("returns linked rows ordered by their position on the edited side", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const targetNameFieldId = readNameFieldId(db, target.tableId);
        const linkedNames = ["First", "Second", "Third"];
        for (const name of linkedNames) {
            const targetRowId = createRowAndGetId(db, target.tableId);
            run(db, "updateCellValue", {
                tableId: target.tableId,
                fieldId: targetNameFieldId,
                rowId: targetRowId,
                value: name,
            });
            run(db, "addLink", {
                tableId: source.tableId,
                fieldId: relation.sourceFieldId,
                rowId: sourceRowId,
                linkedRowId: targetRowId,
            });
        }

        const {rows} = run(db, "listLinkedRows", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
        });

        expect(rows.map(row => row.name)).toEqual(linkedNames);
        db.close();
    });
});

describe("moveLink", () => {
    test("reorders a link on the edited side of the relation", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const targetNameFieldId = readNameFieldId(db, target.tableId);
        const targetRowIds: Array<DatabaseRowId> = [];
        for (const name of ["First", "Second", "Third"]) {
            const targetRowId = createRowAndGetId(db, target.tableId);
            targetRowIds.push(targetRowId);
            run(db, "updateCellValue", {
                tableId: target.tableId,
                fieldId: targetNameFieldId,
                rowId: targetRowId,
                value: name,
            });
            run(db, "addLink", {
                tableId: source.tableId,
                fieldId: relation.sourceFieldId,
                rowId: sourceRowId,
                linkedRowId: targetRowId,
            });
        }

        // Move "Third" to the front by giving it a key before "First".
        const {rows: before} = run(db, "listLinkedRows", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
        });
        run(db, "moveLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: targetRowIds[2]!,
            position: generateOrderKeyBetween(null, before[0]!.position),
        });

        const {rows: after} = run(db, "listLinkedRows", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
        });

        expect(after.map(row => row.name)).toEqual(["Third", "First", "Second"]);
        db.close();
    });
});

describe("createAndLinkRow", () => {
    test("creates a named row in the linked table and links it", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
            cardinality: "many",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const linkedRowId = generateChronologicalId<DatabaseRowId>();

        run(db, "createAndLinkRow", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId,
            name: "Frog",
        });

        const {rows} = run(db, "listLinkedRows", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
        });

        expect(rows).toEqual([{id: linkedRowId, name: "Frog", position: expect.anything()}]);
        db.close();
    });

    test("replaces the existing link for one-cardinality fields", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
            cardinality: "one",
        });
        const sourceRowId = createRowAndGetId(db, source.tableId);
        const firstTargetRowId = createRowAndGetId(db, target.tableId);
        run(db, "addLink", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: firstTargetRowId,
        });

        run(db, "createAndLinkRow", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
            linkedRowId: generateChronologicalId<DatabaseRowId>(),
            name: "Frog",
        });

        const {rows} = run(db, "listLinkedRows", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            rowId: sourceRowId,
        });

        expect(rows.map(row => row.name)).toEqual(["Frog"]);
        db.close();
    });
});

// Renames flow through `syncTableMetadata` (the only rename path — driven by the
// Dynamo metadata sync).
function renameTableForTest(
    db: Database,
    tableId: DatabaseTableId,
    name: string,
): DatabaseActionOutput<"syncTableMetadata"> {
    return run(db, "syncTableMetadata", {
        tableId,
        name,
        accessPolicy: databaseTableAccessPolicyForCreator(testAccountId),
        policyRevision: {tableMetadataVersion: 2, sourcePolicyVersion: 0},
    });
}

describe("syncTableMetadata", () => {
    test("relabels without changing tableName when slug is unchanged", async () => {
        const db = await createDb();
        const {tableId, tableName: original} = createTableForTest(db, "Tasks");

        // "Tasks" and "Tasks!" both slugify to "tasks", so the SQL table name should not
        // change — only the label.
        const {tableName} = renameTableForTest(db, tableId, "Tasks!");

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
        const {tableId} = createTableForTest(db, "Tasks");
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, "tasks")} (name)
            VALUES
                ('keep me')
        `.exec(db);

        const {tableName} = renameTableForTest(db, tableId, "Projects");

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

    test("rename deduplicates against other tables", async () => {
        const db = await createDb();
        createTableForTest(db, "Tasks");
        const {tableId} = createTableForTest(db, "Projects");

        const {tableName} = renameTableForTest(db, tableId, "Tasks");

        expect(tableName).toBe("tasks_2");
        db.close();
    });

    test("rename keeps the table store\u2019s name-uniqueness probe current", async () => {
        const db = await createDb();
        const {tableId} = createTableForTest(db, "Tasks");

        renameTableForTest(db, tableId, "Projects");

        // The store's table_name is the uniqueness index future creates and renames probe;
        // a stale value would let a new "Projects" table collide (or block "Tasks"
        // forever).
        const collision = createTableForTest(db, "Projects");
        expect(collision.tableName).toBe("projects_2");
        db.close();
    });
});

describe("getViewRowsPageCursor", () => {
    test("returns null endCursor when fewer rows than limit exist", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = createTableForTest(db, "T");
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
        const {tableId, viewId, tableName} = createTableForTest(db, "T");
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
        const {tableId, viewId, tableName} = createTableForTest(db, "T");
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
        const {tableId, viewId, tableName} = createTableForTest(db, "T");
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
        const {tableId, viewId, tableName} = createTableForTest(db, "T");
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
        const {tableId, viewId, tableName} = createTableForTest(db, "T");
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

    test("checkbox values are deserialized via the field provider sqlValueSchema", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = createTableForTest(db, "T");
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
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
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
                    {id: firstTargetRowId, name: "Alpha", position: "a0"},
                    {id: secondTargetRowId, name: "Beta", position: "a1"},
                ],
            },
            {id: secondSourceRowId, links: []},
        ]);
        db.close();
    });

    test("formats relation names through the linked table name-field provider", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
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
                config = jsonb (${DatabaseFieldConfigSqlSchema.serialize({
                type: "number",
                decimalPlaces: 2,
            })})
            WHERE
                id = ${scoreFieldId}
        `.exec(db);
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
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
            {id: targetRowId, name: "3.14", position: "a0"},
        ]);
        db.close();
    });

    test("keeps cursor slicing unchanged when projecting relation fields", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
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
        const table = createTableForTest(db, "Tasks");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: table.tableId,
            sourceFieldName: "Related",
            targetTableId: table.tableId,
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
                sourceLinks: [{id: targetRowId, name: "Child", position: "a0"}],
                targetLinks: [],
            },
            {
                id: targetRowId,
                sourceLinks: [],
                targetLinks: [{id: sourceRowId, name: "Parent", position: "a0"}],
            },
        ]);
        db.close();
    });
});

describe("updateCellValue", () => {
    test("writes the value to the table after serializing through the provider", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = createTableForTest(db, "T");
        const {fieldId: nameFieldId} = sql`
            SELECT
                id
            FROM
                ${sql.tableRef(tableId, "_alpine_fields")}
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
        const {tableId, viewId, tableName} = createTableForTest(db, "T");
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
    test("adds the field to all views in the table", async () => {
        const db = await createDb();
        const {tableId, viewId} = createTableForTest(db, "T");
        const secondViewId = generateId<DatabaseViewId>();
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, "_alpine_views")} (id, name)
            VALUES
                (${secondViewId}, 'Second view')
        `.exec(db);
        const fieldId = generateId<DatabaseFieldId>();

        run(db, "createField", {
            fieldId,
            tableId,
            name: "Status",
            config: {type: "plainText"},
        });

        const viewFields = sql`
            SELECT
                view_id,
                field_id,
                width,
                is_visible
            FROM
                ${sql.tableRef(tableId, "_alpine_view_fields")}
            WHERE
                field_id = ${fieldId}
            ORDER BY
                view_id
        `.selectAllUnknown(db);
        expect(viewFields).toMatchObject([
            {
                view_id: viewId,
                field_id: fieldId,
                width: databaseViewDefaultColumnWidth,
                is_visible: 1,
            },
            {
                view_id: secondViewId,
                field_id: fieldId,
                width: databaseViewDefaultColumnWidth,
                is_visible: 1,
            },
        ]);
        db.close();
    });

    test("rejects relation fields", async () => {
        const db = await createDb();
        const {tableId} = createTableForTest(db, "T");
        const fieldId = generateId<DatabaseFieldId>();

        expect(() => {
            run(db, "createField", {
                fieldId,
                tableId,
                name: "Links",
                config: {
                    type: "relation",
                    joinTableId: generateId<DatabaseTableId>(),
                    side: "source",
                    cardinality: "many",
                    linkedTableId: tableId,
                },
            });
        }).toThrow("use createRelationField");
        db.close();
    });
});

describe("updateFieldConfig", () => {
    test("rejects relation linkedTableId changes", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
            cardinality: "many",
        });
        const config = readFieldById(db, source.tableId, relation.sourceFieldId).config;
        assert(config.type === "relation", "expected relation config");

        expect(() => {
            run(db, "updateFieldConfig", {
                tableId: source.tableId,
                fieldId: relation.sourceFieldId,
                config: {
                    ...config,
                    linkedTableId: generateId<DatabaseTableId>(),
                },
            });
        }).toThrow("cannot update relation field linkedTableId");
        db.close();
    });
});

describe("createRow", () => {
    test("inserts a row with the given _id and uses column defaults for the rest", async () => {
        const db = await createDb();
        const {tableId, tableName} = createTableForTest(db, "T");
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
        const {tableId, viewId} = createTableForTest(db, "T");
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
        const {tableId, viewId, tableName} = createTableForTest(db, "T");
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
        const {tableId, viewId} = createTableForTest(db, "T");
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
        const {tableId, viewId} = createTableForTest(db, "T");
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

    test("renames relation field metadata and keeps the join table name in sync", async () => {
        const db = await createDb();
        const source = createTableForTest(db, "Tasks");
        const target = createTableForTest(db, "Projects");
        const relation = run(db, "createRelationField", {
            joinTableId: generateId<DatabaseTableId>(),
            sourceTableId: source.tableId,
            sourceFieldName: "Project",
            targetTableId: target.tableId,
            cardinality: "many",
        });

        run(db, "renameField", {
            tableId: source.tableId,
            fieldId: relation.sourceFieldId,
            name: "Partners",
        });

        const meta = sql`
            SELECT
                name,
                column_name
            FROM
                ${sql.tableRef(source.tableId, "_alpine_fields")}
            WHERE
                id = ${relation.sourceFieldId}
        `.selectOne(db, {
            name: Schema.string,
            columnName: Schema.string.originalPropertyKey("column_name"),
        });
        const joinTableName = sql`
            SELECT
                table_name
            FROM
                ${sql.tableRef(relation.joinTableId, "_alpine_join_table")}
        `.selectValue(db, Schema.string);
        expect({meta, joinTableName}).toMatchObject({
            meta: {name: "Partners", columnName: "partners"},
            joinTableName: "partners_tasks",
        });
        db.close();
    });
});
