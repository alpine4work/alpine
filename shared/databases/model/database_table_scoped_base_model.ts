import {DatabaseSchemaScopedBaseModel} from "~/shared/databases/model/database_schema_scoped_base_model.js";
import type {DatabaseTableModel} from "~/shared/databases/model/database_table_model.js";

export abstract class DatabaseTableScopedBaseModel extends DatabaseSchemaScopedBaseModel {
    constructor(readonly table: DatabaseTableModel) {
        super(table.schema, table.root);
    }
}
