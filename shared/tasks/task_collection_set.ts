import {CrdtMap, CrdtMapAction, createCrdtMap} from "~/shared/crdt/crdt_map.js";
import {CrdtRegister} from "~/shared/crdt/crdt_register.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
    compareHybridLogicalTimes,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema} from "~/shared/schema/schema.js";

const TaskCollectionSetEntries = createCrdtMap(Schema.id<TaskCollectionId>(), OrderKeySchema);
type TaskCollectionSetEntries = CrdtMap<TaskCollectionId, OrderKey>;

export type TaskCollectionSetAction = CrdtMapAction<TaskCollectionId, OrderKey>;

/**
 * An ordered set of collections a task is in. This type is an operation-based
 * [CRDT][1]. That means the actions which update it (see
 * `TaskCollectionSetAction`) are commutative and idempotent.
 *
 * We model this as a map of `TaskCollectionId` to `OrderKey`, but logically you
 * should think of this as a list of unique `TaskCollectionId`. `OrderKey`
 * determines the order of the list so you can easily insert move
 * `TaskCollectionId`s.
 *
 * This set includes:
 *
 * - Deleted collections
 * - Collections the current account doesn't have access to
 *
 * Clients must take care to only render undeleted collections the current account
 * has access to out of this set. Trying to render everything may cause problems.
 * The `createDisplayTaskCollectionsStore()` function can help with this.
 *
 * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
 */
export class TaskCollectionSet {
    private readonly _entries: TaskCollectionSetEntries;
    private _array: ReadonlyArray<{
        collectionId: TaskCollectionId;
        orderKey: OrderKey;
        version: HybridLogicalTime;
    }> | null = null;

    private constructor(entries: TaskCollectionSetEntries) {
        this._entries = entries;

        // In Jest eagerly call `getArray()` which caches some data so `expect().toEqual()`
        // never shows uncached data as the reason why two objects don't match. Seeing the
        // cached data can also help determine the difference in a diff.
        if (import.meta.jest) {
            this.getArray();
        }
    }

    public static readonly ValueRegister = TaskCollectionSetEntries.ValueRegister;
    public static readonly empty = new TaskCollectionSet(TaskCollectionSetEntries.empty);

    public static readonly schema = TaskCollectionSetEntries.schema.transform<TaskCollectionSet>({
        serialize: set => set._entries,
        deserialize: entries => new TaskCollectionSet(entries),
    });

    public static readonly actionSchema = TaskCollectionSetEntries.actionSchema;

    public static from(entries: Iterable<[TaskCollectionId, CrdtRegister<OrderKey | null>]>) {
        return new TaskCollectionSet(TaskCollectionSetEntries.from(entries));
    }

    /**
     * Get all the collections in the set in order.
     *
     * We include the `orderKey` for each collection so you can insert a new collection
     * wherever you'd like in the set.
     */
    public getArray(): ReadonlyArray<{
        collectionId: TaskCollectionId;
        orderKey: OrderKey;
        version: HybridLogicalTime;
    }> {
        if (this._array === null) {
            const array = Array.from(
                this._entries.entriesWithVersion(),
                ([collectionId, {value: orderKey, version}]) => ({
                    collectionId,
                    orderKey,
                    version,
                }),
            );

            array.sort(
                (entry1, entry2) =>
                    defaultCompareStrings(entry1.orderKey, entry2.orderKey) ||
                    compareHybridLogicalTimes(entry1.version, entry2.version) ||
                    defaultCompareStrings(entry1.collectionId, entry2.collectionId),
            );

            this._array = array;
        }

        return this._array;
    }

    public entries() {
        return this._entries.entries();
    }

    public entriesWithVersion() {
        return this._entries.entriesWithVersion();
    }

    public actualEntries() {
        return this._entries.actualEntries();
    }

    public has(collectionId: TaskCollectionId): boolean {
        return this._entries.has(collectionId);
    }

    public getOrderKey(collectionId: TaskCollectionId): OrderKey | undefined {
        return this._entries.get(collectionId);
    }

    public getVersion(collectionId: TaskCollectionId): HybridLogicalTime | undefined {
        return this._entries.getWithVersion(collectionId)?.version;
    }

    public getOrderKeyAndVersion(
        collectionId: TaskCollectionId,
    ): {orderKey: OrderKey; version: HybridLogicalTime} | undefined {
        const entry = this._entries.getWithVersion(collectionId);
        if (entry === undefined) return undefined;
        return {orderKey: entry.value, version: entry.version};
    }

    public getLastOrderKey(): OrderKey | null {
        const array = this.getArray();
        if (array.length === 0) return null;
        return array[array.length - 1]!.orderKey;
    }

    public push(
        clock: HybridLogicalClock,
        collectionId: TaskCollectionId,
    ): TaskCollectionSetAction {
        const array = this.getArray();
        return this._entries.set(
            clock,
            collectionId,
            generateOrderKeyBetween(
                array.length > 0 ? array[array.length - 1]!.orderKey : null,
                null,
            ),
        );
    }

    public delete(
        clock: HybridLogicalClock,
        collectionId: TaskCollectionId,
    ): TaskCollectionSetAction {
        return this._entries.delete(clock, collectionId);
    }

    public apply(action: TaskCollectionSetAction): TaskCollectionSet {
        const newEntries = this._entries.apply(action);
        if (this._entries === newEntries) return this;
        return new TaskCollectionSet(newEntries);
    }

    public merge(other: TaskCollectionSet) {
        const newEntries = this._entries.merge(other._entries);
        if (this._entries === newEntries) return this;
        return new TaskCollectionSet(newEntries);
    }

    public isEqual(other: TaskCollectionSet) {
        return this._entries.isEqual(other._entries);
    }

    public tick(clock: {tick(time: HybridLogicalTime): void}) {
        this._entries.tick(clock);
    }
}
