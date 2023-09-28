import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Level of access someone may have against a task collection.
 *
 * - `View`: The person can view tasks in the collection but can't do
 *   anything else.
 * - `Comment`: The person can view and comment on tasks in the collection but
 *   can't do anything else.
 * - `Edit`: The person can make any change to tasks in the collection but
 *   can't change the collection name or grant access.
 * - `Manage`: The person can do anything in the collection.
 */
export type TaskCollectionAccessLevel = SchemaType<typeof TaskCollectionAccessLevelSchema>;

const taskCollectionAccessLevels = ["View", "Comment", "Edit", "Manage"] as const;

const TaskCollectionAccessLevelSchema = Schema.enum(taskCollectionAccessLevels);

/**
 * Does someone's access level high enough to take an action at the expected
 * access level?
 */
export function hasTaskCollectionAccessLevel(
    actualLevel: TaskCollectionAccessLevel,
    expectedLevel: TaskCollectionAccessLevel,
): boolean {
    const actualIndex = taskCollectionAccessLevels.indexOf(actualLevel);
    const expectedIndex = taskCollectionAccessLevels.indexOf(expectedLevel);
    assert(actualIndex >= 0 && expectedIndex >= 0);
    return actualIndex >= expectedIndex;
}

/**
 * Return the higher of the two access levels.
 */
export function maxTaskCollectionAccessLevel(
    level1: TaskCollectionAccessLevel,
    level2: TaskCollectionAccessLevel,
): TaskCollectionAccessLevel {
    const index1 = taskCollectionAccessLevels.indexOf(level1);
    const index2 = taskCollectionAccessLevels.indexOf(level2);
    assert(index1 >= 0 && index2 >= 0);

    if (index2 > index1) return level2;
    return level1;
}

/**
 * Task collection access grant to a single person.
 */
export type TaskCollectionAccessPolicyAccountGrant = SchemaType<
    typeof TaskCollectionAccessPolicyAccountGrantSchema
>;

const TaskCollectionAccessPolicyAccountGrantSchema = Schema.object({
    level: TaskCollectionAccessLevelSchema,
});

/**
 * Task collection access grant to a broad group of people. For example,
 * "everyone in the space excluding guests" or "everyone on the internet".
 */
export type TaskCollectionAccessPolicyDefaultGrant = SchemaType<
    typeof TaskCollectionAccessPolicyDefaultGrantSchema
>;

const TaskCollectionAccessPolicyDefaultGrantSchema = Schema.union({
    Space: Schema.object({
        type: Schema.value("Space"),
        level: TaskCollectionAccessLevelSchema,
    }),
});

/**
 * Policy designating who is allowed to interact with the tasks in a task
 * collection.
 */
// TODO(calebmer): I want all entities to use the same share dialog UI. That
// means this access policy system will need to be generalized soon-ish.
export type TaskCollectionAccessPolicy = SchemaType<typeof TaskCollectionAccessPolicySchema>;

export const TaskCollectionAccessPolicySchema = Schema.object({
    accountGrantById: Schema.map(
        Schema.id<AccountId>(),
        TaskCollectionAccessPolicyAccountGrantSchema,
    ),
    defaultGrant: TaskCollectionAccessPolicyDefaultGrantSchema.nullable(),
});

export const TaskCollectionAccessPolicyRegister = createCrdtRegister(
    TaskCollectionAccessPolicySchema,
);
