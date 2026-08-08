import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {allowAllTableAccess} from "~/shared/databases/allow_all_table_access.js";
import {databaseTableAccessPolicyForCreator} from "~/shared/databases/database_table_access_policy.js";
import {formatUniqueTableName} from "~/shared/databases/format_unique_table_name.js";
import type {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import {DatabaseModel} from "~/shared/databases/model/database_root_model.js";
import {databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {
    runJoinTableMigrations,
    runMainMigrations,
    runTableMigrations,
} from "~/shared/databases/sqlite_migrations.js";
import {InMemoryDatabaseServerTableStore} from "~/shared/databases/test_helpers/in_memory_database_server_table_store.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {
    AccountId,
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.open_source.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;
const testAccountId = generateId<AccountId>();

// Test stand-in for the action server context: `formatUniqueTableName` and
// `registerTable` reach the table store through `model.ctx.server()`.
function createTestModel(db: SqliteDatabase): DatabaseModel {
    return new DatabaseModel(
        db,
        {
            attach() {},
            getCurrentAccountId() {
                return null;
            },
            tables: new InMemoryDatabaseServerTableStore(),
        },
        allowAllTableAccess,
    );
}

async function createDb(): Promise<SqliteDatabase> {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-model-${dbCounter++}.sqlite3`, "ct");
    registerSqliteCustomFunctions(sqlite3, db);
    runMainMigrations(db);
    return db;
}

function attachTableDb(db: SqliteDatabase, tableId: DatabaseTableId): void {
    sql` ATTACH DATABASE ':memory:' AS ${sql.identifier(databaseTableSchemaName(tableId))} `.exec(
        db,
    );
}

function createTable(model: DatabaseModel, tableId: DatabaseTableId, name: string) {
    // Mirrors the createTable action: resolve the unique name, register the table,
    // migrate the per-table file, then create the metadata.
    const tableName = formatUniqueTableName({model, name});
    model.registerTable(tableId, {
        kind: "table",
        tableName,
        accessPolicy: databaseTableAccessPolicyForCreator(testAccountId),
    });
    attachTableDb(model.db, tableId);
    runTableMigrations(model.db, tableId);
    return model.createTable(tableId, {
        name,
        tableName,
    });
}

// Mirrors the createRelationField action: resolve the join table's unique name,
// register the join table with its topology, migrate its file, then create the
// join table metadata.
function createJoinTableWithUniqueName(
    model: DatabaseModel,
    joinTableId: DatabaseTableId,
    sourceField: DatabaseFieldModel,
    targetField: DatabaseFieldModel,
) {
    const tableName = formatUniqueTableName({
        model,
        name: `${sourceField.name} ${targetField.name}`,
    });
    model.registerTable(joinTableId, {
        kind: "join",
        tableName,
        sourceTableId: sourceField.table.id,
        targetTableId: targetField.table.id,
    });
    runJoinTableMigrations(model.db, joinTableId);
    return model.createJoinTable(sourceField, targetField, {tableName});
}

function createRelation(model: DatabaseModel) {
    const sourceId = generateChronologicalId<DatabaseTableId>();
    const targetId = generateChronologicalId<DatabaseTableId>();
    const joinTableId = generateChronologicalId<DatabaseTableId>();
    const source = createTable(model, sourceId, "Tasks").table;
    const target = createTable(model, targetId, "Projects").table;
    attachTableDb(model.db, joinTableId);

    const sourceField = source.createField(generateChronologicalId<DatabaseFieldId>(), "Project", {
        type: "relation",
        joinTableId,
        side: "source",
        cardinality: "many",
        linkedTableId: target.id,
    });
    const targetField = target.createField(generateChronologicalId<DatabaseFieldId>(), "Tasks", {
        type: "relation",
        joinTableId,
        side: "target",
        cardinality: "many",
        linkedTableId: source.id,
    });
    const joinRow = createJoinTableWithUniqueName(model, joinTableId, sourceField, targetField);
    const joinTable = model.getJoinTable(joinRow.id);

    return {source, target, sourceField, targetField, joinTable};
}

function readColumnNames(db: SqliteDatabase, tableId: DatabaseTableId, tableName: string) {
    return sql`PRAGMA ${sql.tableRef(tableId, "table_info")} (${sql.identifier(tableName)})`
        .selectAllUnknown(db)
        .map(column => column.name);
}

describe("DatabaseModel", () => {
    test("createTable creates a default view containing the Name field", async () => {
        const db = await createDb();
        const model = createTestModel(db);
        const tableId = generateChronologicalId<DatabaseTableId>();

        const {table, nameField, defaultView} = createTable(model, tableId, "Tasks");

        const fields = defaultView.getFieldsWithViewMetadata();
        expect({
            tableName: table.tableName,
            field: fields[0],
        }).toMatchObject({
            tableName: "tasks",
            field: {
                id: nameField.id,
                name: "Name",
                width: databaseViewDefaultColumnWidth,
                hidden: false,
            },
        });
        db.close();
    });

    test("appendFieldToAllViews adds a field to every table view", async () => {
        const db = await createDb();
        const model = createTestModel(db);
        const tableId = generateChronologicalId<DatabaseTableId>();
        const {table} = createTable(model, tableId, "Tasks");
        const secondViewId = generateChronologicalId<DatabaseViewId>();
        table.createView(secondViewId, "Second view");

        const field = table.createField(generateChronologicalId<DatabaseFieldId>(), "Status", {
            type: "plainText",
        });
        table.appendFieldToAllViews(field);

        const viewFieldRows = sql`
            SELECT
                view_id,
                field_id,
                width,
                is_visible
            FROM
                ${sql.tableRef(tableId, "_alpine_view_fields")}
            WHERE
                field_id = ${field.id}
            ORDER BY
                view_id
        `.selectAllUnknown(db);
        expect(viewFieldRows).toMatchObject([
            {field_id: field.id, width: databaseViewDefaultColumnWidth, is_visible: 1},
            {field_id: field.id, width: databaseViewDefaultColumnWidth, is_visible: 1},
        ]);
        db.close();
    });

    test("createJoinTable creates metadata and a custom data-table schema", async () => {
        const db = await createDb();
        const model = createTestModel(db);

        const {joinTable} = createRelation(model);

        expect({
            row: joinTable.row,
            columns: readColumnNames(db, joinTable.id, joinTable.tableName),
        }).toMatchObject({
            row: {
                tableName: "project_tasks",
                sourceRowIdColumnName: "tasks_id",
                sourcePositionColumnName: "tasks_position",
                targetRowIdColumnName: "projects_id",
                targetPositionColumnName: "projects_position",
            },
            columns: ["tasks_id", "projects_id", "tasks_position", "projects_position"],
        });
        db.close();
    });

    test("createJoinTable disambiguates self-relation columns", async () => {
        const db = await createDb();
        const model = createTestModel(db);
        const tableId = generateChronologicalId<DatabaseTableId>();
        const joinTableId = generateChronologicalId<DatabaseTableId>();
        const table = createTable(model, tableId, "Tasks").table;
        attachTableDb(db, joinTableId);

        const sourceField = table.createField(
            generateChronologicalId<DatabaseFieldId>(),
            "Related",
            {
                type: "relation",
                joinTableId,
                side: "source",
                cardinality: "many",
                linkedTableId: table.id,
            },
        );
        const targetField = table.createField(generateChronologicalId<DatabaseFieldId>(), "Tasks", {
            type: "relation",
            joinTableId,
            side: "target",
            cardinality: "many",
            linkedTableId: table.id,
        });

        const joinTable = createJoinTableWithUniqueName(
            model,
            joinTableId,
            sourceField,
            targetField,
        );

        expect(readColumnNames(db, joinTable.id, joinTable.tableName)).toEqual([
            "tasks_id",
            "tasks_id_2",
            "tasks_position",
            "tasks_position_2",
        ]);
        db.close();
    });

    test("renaming a related table keeps join table columns and data in sync", async () => {
        const db = await createDb();
        const model = createTestModel(db);
        const {target, joinTable} = createRelation(model);
        const sourceRowId = generateChronologicalId<DatabaseRowId>();
        const targetRowId = generateChronologicalId<DatabaseRowId>();

        sql`
            INSERT INTO
                ${joinTable.tableRef} (
                    ${joinTable.sourceRowIdColumn()},
                    ${joinTable.targetRowIdColumn()},
                    ${joinTable.sourcePositionColumn()},
                    ${joinTable.targetPositionColumn()}
                )
            VALUES
                (
                    ${sourceRowId},
                    ${targetRowId},
                    'a0',
                    'a0'
                )
        `.exec(db);

        target.updateName("Milestones", {
            tableName: formatUniqueTableName({
                model,
                name: "Milestones",
                excludeTableId: target.id,
            }),
        });

        const updatedJoinTable = model.getJoinTable(joinTable.id);
        const row = sql`
            SELECT
                ${updatedJoinTable.sourceRowIdColumn()} AS source_row_id,
                ${updatedJoinTable.targetRowIdColumn()} AS target_row_id
            FROM
                ${updatedJoinTable.tableRef}
        `.selectAllUnknown(db)[0];
        expect({
            row: updatedJoinTable.row,
            columns: readColumnNames(db, updatedJoinTable.id, updatedJoinTable.tableName),
            link: row,
        }).toMatchObject({
            row: {
                targetRowIdColumnName: "milestones_id",
                targetPositionColumnName: "milestones_position",
            },
            columns: ["tasks_id", "milestones_id", "tasks_position", "milestones_position"],
            link: {source_row_id: sourceRowId, target_row_id: targetRowId},
        });
        db.close();
    });

    test("renaming a relation field keeps the join table name in sync", async () => {
        const db = await createDb();
        const model = createTestModel(db);
        const {sourceField, joinTable} = createRelation(model);

        (sourceField as DatabaseFieldModel).updateName("Owner");

        const updatedJoinTable = model.getJoinTable(joinTable.id);
        expect({
            tableName: updatedJoinTable.tableName,
            columns: readColumnNames(db, updatedJoinTable.id, updatedJoinTable.tableName),
        }).toMatchObject({
            tableName: "owner_tasks",
            columns: ["tasks_id", "projects_id", "tasks_position", "projects_position"],
        });
        db.close();
    });
});
