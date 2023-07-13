import {compareAsc} from "date-fns";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {OrderKeySchema} from "~/shared/schema/order_key_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

type TaskCollectionSetEntry = SchemaType<typeof TaskCollectionSetEntrySchema>;

const TaskCollectionSetEntrySchema = Schema.union({
    Present: Schema.object({
        type: Schema.value("Present"),
        updatedTime: Schema.date,
        orderKey: OrderKeySchema,
    }),
    Absent: Schema.object({
        type: Schema.value("Absent"),
        updatedTime: Schema.date,
    }),
});

/**
 * An ordered set of collections a task is in. This type is an operation-based
 * [CRDT][1]. That means the actions which update it
 * (see `TaskCollectionSetAction`) are commutative and idempotent.
 *
 * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
 */
export class TaskCollectionSet {
    private readonly _entries: ReadonlyMap<TaskCollectionId, TaskCollectionSetEntry>;
    private _array: ReadonlyArray<{collectionId: TaskCollectionId; orderKey: OrderKey}> | null =
        null;

    private constructor(entries: ReadonlyMap<TaskCollectionId, TaskCollectionSetEntry>) {
        this._entries = entries;
    }

    public static readonly empty = new TaskCollectionSet(new Map());

    public static readonly schema = Schema.map(
        Schema.id<TaskCollectionId>(),
        TaskCollectionSetEntrySchema,
    ).transform<TaskCollectionSet>({
        serialize: set => set._entries,
        deserialize: entries => new TaskCollectionSet(entries),
    });

    public getArray(): ReadonlyArray<{collectionId: TaskCollectionId; orderKey: OrderKey}> {
        if (this._array === null) {
            const array: Array<{collectionId: TaskCollectionId; orderKey: OrderKey}> = [];

            for (const [collectionId, entry] of this._entries) {
                if (entry.type === "Present") {
                    array.push({collectionId, orderKey: entry.orderKey});
                }
            }

            array.sort(
                (entry1, entry2) =>
                    defaultCompareStrings(entry1.orderKey, entry2.orderKey) ||
                    defaultCompareStrings(entry1.collectionId, entry2.collectionId),
            );

            this._array = array;
        }

        return this._array;
    }

    public apply(action: TaskCollectionSetAction): TaskCollectionSet {
        const newEntries = applyTaskCollectionSetAction(this._entries, action);
        if (newEntries === this._entries) return this;
        return new TaskCollectionSet(newEntries);
    }
}

/**
 * An action that updates `TaskCollectionSet`. Actions are commutative and
 * idempotent so they can be a part of our broader task action system.
 */
export type TaskCollectionSetAction = SchemaType<typeof TaskCollectionSetActionSchema>;

export const TaskCollectionSetActionSchema = Schema.union({
    Set: Schema.object({
        type: Schema.value("Set"),
        collectionId: Schema.id<TaskCollectionId>(),
        // Doesn't use `TaskDateModel` because this date is not user filterable.
        updatedTime: Schema.date,
        orderKey: OrderKeySchema,
    }),
    Delete: Schema.object({
        type: Schema.value("Delete"),
        collectionId: Schema.id<TaskCollectionId>(),
        // Doesn't use `TaskDateModel` because this date is not user filterable.
        updatedTime: Schema.date,
    }),
});

function applyTaskCollectionSetAction(
    entries: ReadonlyMap<TaskCollectionId, TaskCollectionSetEntry>,
    action: TaskCollectionSetAction,
): ReadonlyMap<TaskCollectionId, TaskCollectionSetEntry> {
    switch (action.type) {
        case "Set": {
            const oldSetEntry = entries.get(action.collectionId);

            const newSetEntry: TaskCollectionSetEntry = {
                type: "Present",
                updatedTime: action.updatedTime,
                orderKey: action.orderKey,
            };

            if (oldSetEntry && compareTaskCollectionSetEntries(oldSetEntry, newSetEntry) > 0) {
                return entries;
            }

            const newSet = new Map(entries);
            newSet.set(action.collectionId, newSetEntry);
            return newSet;
        }
        case "Delete": {
            const oldSetEntry = entries.get(action.collectionId);

            const newSetEntry: TaskCollectionSetEntry = {
                type: "Absent",
                updatedTime: action.updatedTime,
            };

            if (oldSetEntry && compareTaskCollectionSetEntries(oldSetEntry, newSetEntry) > 0) {
                return entries;
            }

            const newSet = new Map(entries);
            newSet.set(action.collectionId, newSetEntry);
            return newSet;
        }
        default:
            throw exhaustive(action);
    }
}

/**
 * Compare two `TaskCollectionSetEntry`s to pick which one wins in case of
 * conflict. If `updatedTime` is equal (rare in practice) then we tie break
 * based on other properties.
 */
function compareTaskCollectionSetEntries(
    entry1: TaskCollectionSetEntry,
    entry2: TaskCollectionSetEntry,
) {
    const updatedTimeComparison = compareAsc(entry1.updatedTime, entry2.updatedTime);
    if (updatedTimeComparison !== 0) return updatedTimeComparison;

    if (entry1.type === "Absent" && entry2.type === "Absent") return 0;
    if (entry1.type === "Absent") return 1;
    if (entry2.type === "Absent") return -1;

    return defaultCompareStrings(entry1.orderKey, entry2.orderKey);
}
