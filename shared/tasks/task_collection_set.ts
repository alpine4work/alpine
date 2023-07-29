import {CrdtMap, CrdtMapAction, createCrdtMap} from "~/shared/crdt/crdt_map.js";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {OrderKeySchema} from "~/shared/schema/order_key_schema.js";
import {Schema} from "~/shared/schema/schema.js";

const TaskCollectionSetEntries = createCrdtMap(Schema.id<TaskCollectionId>(), OrderKeySchema);
type TaskCollectionSetEntries = CrdtMap<TaskCollectionId, OrderKey>;

export type TaskCollectionSetAction = CrdtMapAction<TaskCollectionId, OrderKey>;

/**
 * An ordered set of collections a task is in. This type is an operation-based
 * [CRDT][1]. That means the actions which update it
 * (see `TaskCollectionSetAction`) are commutative and idempotent.
 *
 * We model this as a map of `TaskCollectionId` to `OrderKey`, but logically
 * you should think of this as a list of unique `TaskCollectionId`. `OrderKey`
 * determines the order of the list so you can easily insert move
 * `TaskCollectionId`s.
 *
 * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
 */
export class TaskCollectionSet {
    private readonly _entries: TaskCollectionSetEntries;
    private _array: ReadonlyArray<{
        collectionId: TaskCollectionId;
        orderKey: OrderKey;
        updatedTime: Date;
    }> | null = null;

    private constructor(entries: TaskCollectionSetEntries) {
        this._entries = entries;
    }

    public static readonly empty = new TaskCollectionSet(TaskCollectionSetEntries.empty);

    public static readonly schema = TaskCollectionSetEntries.schema.transform<TaskCollectionSet>({
        serialize: set => set._entries,
        deserialize: entries => new TaskCollectionSet(entries),
    });

    public static readonly actionSchema = TaskCollectionSetEntries.actionSchema;

    /**
     * Get all the collections in the set in order.
     *
     * We include the `orderKey` for each collection so you can insert a new
     * collection wherever you'd like in the set.
     */
    public getArray(): ReadonlyArray<{
        collectionId: TaskCollectionId;
        orderKey: OrderKey;
        updatedTime: Date;
    }> {
        if (this._array === null) {
            const array = Array.from(
                this._entries.entriesWithUpdatedTime(),
                ([collectionId, {value: orderKey, updatedTime}]) => ({
                    collectionId,
                    orderKey,
                    updatedTime,
                }),
            );

            array.sort(
                (entry1, entry2) =>
                    defaultCompareStrings(entry1.orderKey, entry2.orderKey) ||
                    defaultCompareStrings(entry1.collectionId, entry2.collectionId),
            );

            this._array = array;
        }

        return this._array;
    }

    public has(collectionId: TaskCollectionId): boolean {
        return this._entries.has(collectionId);
    }

    public push(collectionId: TaskCollectionId): TaskCollectionSetAction {
        const array = this.getArray();
        return this._entries.set(
            collectionId,
            generateOrderKeyBetween(
                array.length > 0 ? array[array.length - 1]!.orderKey : null,
                null,
            ),
        );
    }

    public delete(collectionId: TaskCollectionId): TaskCollectionSetAction {
        return this._entries.delete(collectionId);
    }

    public apply(action: TaskCollectionSetAction): TaskCollectionSet {
        return new TaskCollectionSet(this._entries.apply(action));
    }
}
