import {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import {
    DatabaseFieldRow,
    DatabaseViewFieldRow,
    DatabaseViewRow,
} from "~/shared/databases/model/database_row_schemas.js";
import type {DatabaseTableModel} from "~/shared/databases/model/database_table_model.js";
import {DatabaseTableScopedBaseModel} from "~/shared/databases/model/database_table_scoped_base_model.js";
import {SqlBooleanSchema} from "~/shared/databases/model/sqlite_schema.js";
import {sql} from "~/shared/databases/sql.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.open_source.js";

export class DatabaseViewModel extends DatabaseTableScopedBaseModel {
    constructor(
        table: DatabaseTableModel,
        readonly row: DatabaseViewRow,
    ) {
        super(table);
    }

    get id() {
        return this.row.id;
    }
    get name() {
        return this.row.name;
    }

    getFields() {
        return sql`
            SELECT
                fields.id,
                fields.name,
                fields.column_name,
                JSON(fields.config) AS config
            FROM
                ${this.schema}._alpine_view_fields view_fields
                JOIN ${this.schema}._alpine_fields fields ON fields.id = view_fields.field_id
            WHERE
                view_fields.view_id = ${this.id}
            ORDER BY
                view_fields.position
        `
            .selectAll(this.db, DatabaseFieldRow)
            .map(row => new DatabaseFieldModel(this.table, row));
    }

    getFieldsWithViewMetadata() {
        return sql`
            SELECT
                fields.id,
                fields.name,
                fields.column_name,
                JSON(fields.config) AS config,
                view_fields.position,
                view_fields.width,
                NOT view_fields.is_visible AS hidden
            FROM
                ${this.schema}._alpine_view_fields view_fields
                JOIN ${this.schema}._alpine_fields fields ON fields.id = view_fields.field_id
            WHERE
                view_fields.view_id = ${this.id}
            ORDER BY
                view_fields.position
        `.selectAll(this.db, {
            id: DatabaseFieldRow.id,
            name: DatabaseFieldRow.name,
            columnName: DatabaseFieldRow.columnName,
            config: DatabaseFieldRow.config,
            position: DatabaseViewFieldRow.position,
            width: DatabaseViewFieldRow.width,
            hidden: SqlBooleanSchema,
        });
    }

    updateFieldWidth(field: DatabaseFieldModel, width: number) {
        assert(field.table.id === this.table.id);
        sql`
            UPDATE ${this.schema}._alpine_view_fields
            SET
                width = ${width}
            WHERE
                view_id = ${this.id}
                AND field_id = ${field.id}
        `.exec(this.db);
    }

    updateFieldVisibility(field: DatabaseFieldModel, visible: boolean, position: OrderKey) {
        assert(field.table.id === this.table.id);
        sql`
            INSERT INTO
                ${this.schema}._alpine_view_fields (view_id, field_id, is_visible, position, width)
            VALUES
                (
                    ${this.id},
                    ${field.id},
                    ${SqlBooleanSchema.serialize(visible)},
                    ${position},
                    ${databaseViewDefaultColumnWidth}
                )
            ON CONFLICT (view_id, field_id) DO UPDATE
            SET
                is_visible = excluded.is_visible,
                position = excluded.position
        `.exec(this.db);
    }
}
