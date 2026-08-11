import {selectDatabaseCheckboxFieldColumnAsString} from "~/shared/databases/fields/checkbox/select_database_checkbox_field_column_as_string.js";
import {selectDatabaseNumberFieldColumnAsString} from "~/shared/databases/fields/number/select_database_number_field_column_as_string.js";
import {selectDatabaseRelationFieldColumnAsString} from "~/shared/databases/fields/relation/select_database_relation_field_column_as_string.js";
import type {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/** The SQL expression selecting a field's value formatted as display text. */
export function selectDatabaseFieldColumnAsString(
    field: DatabaseFieldModel,
    dataRow: SqlQuery,
): SqlQuery {
    switch (field.config.type) {
        case "plainText":
            return sql`${dataRow}.${field.column()}`;
        case "checkbox":
            assert(field.isType("checkbox"));
            return selectDatabaseCheckboxFieldColumnAsString(field, dataRow);
        case "number":
            assert(field.isType("number"));
            return selectDatabaseNumberFieldColumnAsString(field, dataRow);
        case "relation":
            assert(field.isType("relation"));
            return selectDatabaseRelationFieldColumnAsString(field, dataRow);
        default:
            throw exhaustive(field.config);
    }
}
