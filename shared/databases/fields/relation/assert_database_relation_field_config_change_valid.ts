import type {DatabaseRelationFieldConfig} from "~/shared/databases/fields/relation/database_relation_field.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * Asserts that updating a relation field's config from `existingConfig` to
 * `nextConfig` is allowed. A relation's topology (join table, side, linked table)
 * is immutable; only `cardinality` may change.
 */
export function assertDatabaseRelationFieldConfigChangeValid(
    existingConfig: DatabaseRelationFieldConfig,
    nextConfig: DatabaseRelationFieldConfig,
) {
    assert(
        nextConfig.joinTableId === existingConfig.joinTableId,
        "cannot update relation field joinTableId",
    );
    assert(nextConfig.side === existingConfig.side, "cannot update relation field side");
    assert(
        nextConfig.linkedTableId === existingConfig.linkedTableId,
        "cannot update relation field linkedTableId",
    );
}
