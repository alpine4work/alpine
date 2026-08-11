import {selectDatabaseRelationFieldColumn} from "~/shared/databases/fields/relation/select_database_relation_field_column.js";
import type {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Returns the SQL expression that selects a typed field value from `dataRow`.
 * Callers use one function for physical columns and virtual relation fields, so
 * they do not need to know how each field type is stored.
 */
export function selectDatabaseFieldColumn(field: DatabaseFieldModel, dataRow: SqlQuery): SqlQuery {
    switch (field.config.type) {
        case "PlainText":
        case "Checkbox":
        case "Number":
            return sql`${dataRow}.${field.column()}`;
        case "Relation":
            assert(field.isType("Relation"));
            return selectDatabaseRelationFieldColumn(field, dataRow);
        default:
            throw exhaustive(field.config);
    }
}
