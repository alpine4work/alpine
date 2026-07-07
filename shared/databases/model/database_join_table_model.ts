import {formatUniqueTableName} from "~/shared/databases/format_unique_table_name.js";
import type {DatabaseModel} from "~/shared/databases/model/database_root_model.js";
import {DatabaseJoinTableRow} from "~/shared/databases/model/database_row_schemas.js";
import {DatabaseSchemaScopedBaseModel} from "~/shared/databases/model/database_schema_scoped_base_model.js";
import {SqlQuery, databaseTableSchemaName, sql} from "~/shared/databases/sql.js";

export class DatabaseJoinTableModel extends DatabaseSchemaScopedBaseModel {
    readonly tableRef: SqlQuery;

    constructor(
        root: DatabaseModel,
        readonly row: DatabaseJoinTableRow,
    ) {
        const schema = sql.identifier(databaseTableSchemaName(row.id));
        super(schema, root);
        this.tableRef = sql.identifier(databaseTableSchemaName(this.id), this.tableName);
    }

    get id() {
        return this.row.id;
    }
    get tableName() {
        return this.row.tableName;
    }
    get sourceTableId() {
        return this.row.sourceTableId;
    }
    get sourceFieldId() {
        return this.row.sourceFieldId;
    }
    get targetTableId() {
        return this.row.targetTableId;
    }
    get targetFieldId() {
        return this.row.targetFieldId;
    }
    get sourceRowIdColumnName() {
        return this.row.sourceRowIdColumnName;
    }
    sourceRowIdColumn() {
        return sql.identifier(this.sourceRowIdColumnName);
    }
    get sourcePositionColumnName() {
        return this.row.sourcePositionColumnName;
    }
    sourcePositionColumn() {
        return sql.identifier(this.sourcePositionColumnName);
    }
    get targetRowIdColumnName() {
        return this.row.targetRowIdColumnName;
    }
    targetRowIdColumn() {
        return sql.identifier(this.targetRowIdColumnName);
    }
    get targetPositionColumnName() {
        return this.row.targetPositionColumnName;
    }
    targetPositionColumn() {
        return sql.identifier(this.targetPositionColumnName);
    }

    ensureTableNameIsUpToDate(hashWithPrivateSalt: (value: string) => string) {
        const sourceName = this.root.getTable(this.sourceTableId).getField(this.sourceFieldId).name;
        const targetName = this.root.getTable(this.targetTableId).getField(this.targetFieldId).name;

        const {tableName: joinTableName, tableNameHash} = formatUniqueTableName({
            model: this.root,
            hashWithPrivateSalt,
            name: `${sourceName} ${targetName}`,
            excludeTableId: this.id,
        });

        if (joinTableName === this.tableName) return;

        sql`
            ALTER TABLE ${this.tableRef}
            RENAME TO ${sql.identifier(joinTableName)}
        `.exec(this.db);

        sql`
            UPDATE ${this.schema}._alpine_join_table
            SET
                table_name = ${joinTableName}
            WHERE
                id = ${this.id}
        `.exec(this.db);
        this.root.writeTableNameHash(this.id, tableNameHash);
    }

    ensureColumnNamesAreUpToDate() {
        const sourceTable = this.root.getTable(this.sourceTableId);
        const targetTable = this.root.getTable(this.targetTableId);
        const {
            sourceRowIdColumnName,
            sourcePositionColumnName,
            targetRowIdColumnName,
            targetPositionColumnName,
        } = this.root.formatJoinTableColumnNames(sourceTable, targetTable);

        if (
            sourceRowIdColumnName === this.sourceRowIdColumnName &&
            sourcePositionColumnName === this.sourcePositionColumnName &&
            targetRowIdColumnName === this.targetRowIdColumnName &&
            targetPositionColumnName === this.targetPositionColumnName
        ) {
            return;
        }

        sql`
            UPDATE ${this.schema}._alpine_join_table
            SET
                source_row_id_column_name = ${sourceRowIdColumnName},
                source_position_column_name = ${sourcePositionColumnName},
                target_row_id_column_name = ${targetRowIdColumnName},
                target_position_column_name = ${targetPositionColumnName}
            WHERE
                id = ${this.id}
        `.exec(this.db);

        const updated = this.root.getJoinTable(this.id);

        if (sourceRowIdColumnName !== this.sourceRowIdColumnName) {
            sql`
                ALTER TABLE ${this.tableRef}
                RENAME COLUMN ${this.sourceRowIdColumn()} TO ${updated.sourceRowIdColumn()}
            `.exec(this.db);
        }
        if (sourcePositionColumnName !== this.sourcePositionColumnName) {
            sql`
                ALTER TABLE ${this.tableRef}
                RENAME COLUMN ${this.sourcePositionColumn()} TO ${updated.sourcePositionColumn()}
            `.exec(this.db);
        }
        if (targetRowIdColumnName !== this.targetRowIdColumnName) {
            sql`
                ALTER TABLE ${this.tableRef}
                RENAME COLUMN ${this.targetRowIdColumn()} TO ${updated.targetRowIdColumn()}
            `.exec(this.db);
        }
        if (targetPositionColumnName !== this.targetPositionColumnName) {
            sql`
                ALTER TABLE ${this.tableRef}
                RENAME COLUMN ${this.targetPositionColumn()} TO ${updated.targetPositionColumn()}
            `.exec(this.db);
        }

        return updated;
    }
}
