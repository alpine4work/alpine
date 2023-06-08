import {AccountModel} from "~/shared/accounts/account_model";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables";
import {AccountId} from "~/shared/id/types/id_types";
import {Schema, SchemaType} from "~/shared/schema/schema";

/**
 * Data referenced by a `TaskQueryFilter` that we need to load to render a
 * `TaskQueryFilter`.
 */
export type TaskQueryFilterReferences = SchemaType<typeof TaskQueryFilterReferencesSchema>;

export const TaskQueryFilterReferencesSchema = Schema.object({
    accountById: Schema.map(Schema.id<AccountId>(), AccountModel.schema()),
});

/**
 * Is the provided `TaskQueryFilterReferences` object empty?
 */
export function isEmptyTaskQueryFilterReferences(references: TaskQueryFilterReferences): boolean {
    // If you add more data to `TaskQueryFilterReferences` in the future, you'll
    // need to come back and update this function.
    assertEqualTypes<keyof TaskQueryFilterReferences, "accountById">();

    return references.accountById.size === 0;
}

/**
 * Merge two `TaskQueryFilterReferences` into one. References in the second
 * object will override references in the first.
 */
export function mergeTaskQueryFilterReferences(
    references1: TaskQueryFilterReferences,
    references2: TaskQueryFilterReferences,
): TaskQueryFilterReferences {
    // Optimization: Don't create a new references object for every step we receive
    // from the server with empty references.
    if (isEmptyTaskQueryFilterReferences(references1)) return references2;
    if (isEmptyTaskQueryFilterReferences(references2)) return references1;

    return {
        accountById: new Map(concatIterables(references1.accountById, references2.accountById)),
    };
}
