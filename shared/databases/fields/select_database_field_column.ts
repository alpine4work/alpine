import {selectDatabaseRelationFieldColumn} from "~/shared/databases/fields/relation/select_database_relation_field_column.js";
import type {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * The SQL expression selecting a field's typed value for a row of `dataRow`.
 */
export function selectDatabaseFieldColumn(field: DatabaseFieldModel, dataRow: SqlQuery): SqlQuery {
    switch (field.config.type) {
        case "plainText":
        case "checkbox":
        case "number":
            return sql`${dataRow}.${field.column()}`;
        case "relation":
            assert(field.isType("relation"));
            return selectDatabaseRelationFieldColumn(field, dataRow);
        default:
            throw exhaustive(field.config);
    }
}
