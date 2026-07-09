import fc, {Arbitrary, MaybeWeightedArbitrary} from "fast-check";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

// The binary serialization format stores the sort list length in 7 bits, see
// `serializeTaskQuerySorts()`.
const maxTaskQuerySortsLength = 2 ** 7 - 1;

// Use TypeScript `Record` so we get a type error when a type is added to the
// union, reminding us that we need to add another entry. This mirrors
// `createUnionArbitrary()` in `api_content_arbitrary.ts`.
function createUnionArbitrary<Value extends {readonly type: string}>(
    object: Record<Value["type"], MaybeWeightedArbitrary<Value>>,
): Arbitrary<Value> {
    const arbitraries: Array<MaybeWeightedArbitrary<Value>> = Object.values(object);
    return fc.oneof(...arbitraries);
}

const TaskQuerySortDirectionArbitrary = fc.constantFrom<"Ascending" | "Descending">(
    "Ascending",
    "Descending",
);

const TaskQuerySortMissingArbitrary = fc.constantFrom<"First" | "Last">("First", "Last");

/**
 * An arbitrary that covers every possible `TaskQuerySort`. If a sort is
 * representable by the `TaskQuerySort` data structure then this arbitrary
 * generates it.
 */
export const TaskQuerySortArbitrary: Arbitrary<TaskQuerySort> = createUnionArbitrary<TaskQuerySort>(
    {
        DisplayStatus: fc.record({
            type: fc.constant("DisplayStatus"),
            direction: TaskQuerySortDirectionArbitrary,
        }),
        Priority: fc.record({
            type: fc.constant("Priority"),
            direction: TaskQuerySortDirectionArbitrary,
        }),
        Layout: fc.record({
            type: fc.constant("Layout"),
            missing: TaskQuerySortMissingArbitrary,
        }),
        Assignee: fc.record({
            type: fc.constant("Assignee"),
            missing: TaskQuerySortMissingArbitrary,
        }),
        Creator: fc.record({
            type: fc.constant("Creator"),
        }),
        Assigner: fc.record({
            type: fc.constant("Assigner"),
            missing: TaskQuerySortMissingArbitrary,
        }),
        DueDate: fc.record({
            type: fc.constant("DueDate"),
            direction: TaskQuerySortDirectionArbitrary,
        }),
        CreatedTime: fc.record({
            type: fc.constant("CreatedTime"),
            direction: TaskQuerySortDirectionArbitrary,
        }),
        AssignedTime: fc.record({
            type: fc.constant("AssignedTime"),
            direction: TaskQuerySortDirectionArbitrary,
        }),
        ClosedTime: fc.record({
            type: fc.constant("ClosedTime"),
            direction: TaskQuerySortDirectionArbitrary,
        }),
        ActivatedTime: fc.record({
            type: fc.constant("ActivatedTime"),
            direction: TaskQuerySortDirectionArbitrary,
        }),
    },
);

/**
 * An arbitrary for a list of task query sorts like the ones stored in task views.
 * Lists may repeat sort types since the data structure allows it.
 */
export const TaskQuerySortsArbitrary: Arbitrary<ReadonlyArray<TaskQuerySort>> = fc.array(
    TaskQuerySortArbitrary,
    {maxLength: maxTaskQuerySortsLength},
);
