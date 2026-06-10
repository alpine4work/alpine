/* eslint-disable cyberworlds/no-model-initial-data */

import {unstable_LowPriority, unstable_scheduleCallback} from "scheduler";
import {InternalError} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AdvancedWeakValuesMap} from "~/shared/helpers/map/advanced_weak_values_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {
    SearchEntityModel,
    SearchEntityModelData,
    SearchEntityModelId,
} from "~/shared/search/search_entity_model.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {emptyArrayStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

/**
 * Friends of `SearchEntityRegistry` have their own `Store`s representing entities
 * that are also present in `SearchEntityRegistry`. We want to include the data
 * from those stores in our entity representation in `SearchEntityRegistry` so we
 * show a consistent representation of the entity everywhere.
 *
 * Right now `TaskClientStore` is the only friend of `SearchEntityRegistry`.
 * `TaskClientStore` holds `TaskModel`s and `TaskCollectionModel`s. As tasks and
 * collections are updated in realtime `TaskClientStore` incorporates these changes
 * into its task/collection stores. `SearchEntityRegistry` calls
 * `getSearchEntityRegistryFriendStoreIfExists()` on `TaskClientStore` to
 * incorporate updates to `TaskModel`s into the `SearchEntityModel` we render.
 *
 * `SearchEntityRegistry` holds onto the latest data from friends forever even if
 * it's no longer available in the underlying store. For example, if a
 * `<TaskDetailView>` is rendered then unrendered `TaskClientStore` will update the
 * `TaskModel` store for the `<TaskDetailView>` to null as it unloads the data.
 * `SearchEntityRegistry`, however, remembers the last data it saw for the task.
 */
export interface SearchEntityRegistryFriend {
    getSearchEntityRegistryFriendStoreIfExists(
        entityId: SearchEntityModelId,
    ): Store<SearchEntityModelData | null> | null;
}

/**
 * Normalized registry of search entity model data for the client. When we load
 * data from the server it includes `SearchEntityModel` objects. There may be many
 * `SearchEntityModel` objects with different data that represent the same
 * underlying entity. This registry will provide one, consistent, view of each
 * `SearchEntityId` on the client. It makes sure we don't render the same entity in
 * different ways in different parts of the product.
 *
 * Written so that entity stores are garbage collected when there are no more
 * references to the associated `SearchEntityModel`s in our realm.
 */
export class SearchEntityRegistry {
    private _scheduledEntityUpdates: Set<SearchEntityModel> | null = null;
    private _entityUpdatesScheduledDuringRun = 0;

    private readonly _friendsStore = new ValueStore<ReadonlySet<SearchEntityRegistryFriend>>(
        emptySet,
    );

    // NOTE(calebmer): We broadly discourage usage of `AdvancedWeakValuesMap` since it
    // leads to non-deterministic behavior. We use it here because it's convenient for
    // the pervasive use of `SearchEntityRegistry` across our codebase.
    //
    // You mostly call `getEntityStore()` on this class which doesn't introduce
    // non-deterministic behavior due to JavaScript garbage collector timing. However,
    // advanced use cases can call `weakGetEntityStoreByIdIfExists()` which does
    // observe non-deterministic behavior due to JavaScript garbage collector timing.
    // It's prefixed with "weak" so callers are discouraged from using it unless they
    // know what they're doing.
    //
    // We could use a simple `Map` but that would lead to a memory leak since search
    // entity data would never be garbage collected. Search entity data is small so
    // arguably a memory leak is acceptable.
    private readonly _entityStoreById = new AdvancedWeakValuesMap<
        SearchEntityModelId,
        Store<SearchEntityModelData> & {
            set(setter: (data: SearchEntityModelData) => SearchEntityModelData): void;
        }
    >();

    private readonly _entityStoreByModel = new WeakMap<
        SearchEntityModel,
        Store<SearchEntityModelData> & {
            set(setter: (data: SearchEntityModelData) => SearchEntityModelData): void;
        }
    >();

    public addFriend(friend: SearchEntityRegistryFriend) {
        this._friendsStore.set(oldFriends => {
            const newFriends = new Set(oldFriends);
            newFriends.add(friend);
            return newFriends;
        });
    }

    public removeFriend(friend: SearchEntityRegistryFriend) {
        this._friendsStore.set(oldFriends => {
            const newFriends = new Set(oldFriends);
            newFriends.delete(friend);
            return newFriends;
        });
    }

    private _createEntityStore(
        entityId: SearchEntityModelId,
        dataStore: ValueStore<SearchEntityModelData>,
    ): Store<SearchEntityModelData> & {
        set(setter: (data: SearchEntityModelData) => SearchEntityModelData): void;
    } {
        const friendDatasStore = this._friendsStore.flatMap(friends => {
            const friendDataStores = filterMapArray(
                friends,
                friend => friend.getSearchEntityRegistryFriendStoreIfExists(entityId) ?? undefined,
            );

            // Optimization: Use `emptyArray` if there are no friend stores so
            // `friendDatasStore` doesn't trigger re-computations whenever `this._friendsStore`
            // changes. Since stores only recompute if dependencies are referentially
            // different.
            if (friendDataStores.length === 0) return emptyArrayStore;

            return Store.many(friendDataStores);
        });

        // Use `reduce()` so we keep friend data around forever even if the friend store is
        // removed. For example, `TaskClientStore` will have data for a task while
        // `<TaskDetailView>` is visible but after `<TaskDetailView>` unmounts it drops the
        // task data. We don't want our `SearchEntityRegistry` to revert back to old data
        // when this happens! So `SearchEntityRegistry` needs to keep the old friend data.
        //
        // `reduce()` lets us keep hold onto data we've previously seen.
        const friendDataStore = friendDatasStore.reduce<SearchEntityModelData | null, null>(
            (friendData, newFriendDatas) => {
                for (const newFriendData of newFriendDatas) {
                    if (newFriendData === null) continue;

                    if (friendData === null) {
                        friendData = newFriendData;
                    } else {
                        friendData = SearchEntityModel.mergeData(friendData, newFriendData);
                    }
                }

                return friendData;
            },
            null,
        );

        const store = Store.map(friendDataStore, dataStore, (friendData, data) => {
            if (friendData === null) return data;
            return SearchEntityModel.mergeData(friendData, data);
        });

        return Object.assign(store, {set: dataStore.set.bind(dataStore)});
    }

    private _getEntityStoreWithoutUpdating(
        entity: SearchEntityModel,
    ): Store<SearchEntityModelData> & {
        set(setter: (data: SearchEntityModelData) => SearchEntityModelData): void;
    } {
        const entityStore = getOrSetDefaultMapValue(this._entityStoreById, entity.id, () =>
            this._createEntityStore(entity.id, new ValueStore(entity.initialData)),
        );

        // As long as the `SearchEntityModel` lives, hold a reference to
        // `ValueStore<SearchEntityModelData>`. This prevents a bug where we're in a
        // virtualized scroll view and a component rendering a `SearchEntityModel` is
        // scrolled offscreen so it no longer references the store so the store is garbage
        // collected. If the store held newer `SearchEntityModelData` then when you scroll
        // and `SearchEntityModel` is back onscreen it will appear like the entity reverted
        // to its original state.
        //
        // `SearchEntityModel` will still be referenced by whatever data is backing the
        // virtualized scroll view. So keep a reference to the store alive while the
        // `SearchEntityModel` is alive.
        this._entityStoreByModel.set(entity, entityStore);

        return entityStore;
    }

    /**
     * Get the normalized entity data store for our `SearchEntityModel`.
     *
     * If our store hasn't seen the entity yet then we'll initialize a store with the
     * `SearchEntityModel`'s `initialData`.
     *
     * If our store has seen the entity but our `SearchEntityModel`'s `initialData` is
     * newer than what's in the store, we will schedule a render with the entity's new
     * data. Updating everywhere the entity is visible in the product.
     */
    public getEntityStore(entity: SearchEntityModel): Store<SearchEntityModelData> {
        const entityStore = this._getEntityStoreWithoutUpdating(entity);

        // Don't schedule entity update on the server.
        if (typeof window !== "undefined") {
            const entitySnapshot = entityStore.getSnapshot();
            if (
                entitySnapshot !== SearchEntityModel.mergeData(entitySnapshot, entity.initialData)
            ) {
                this._scheduleEntityUpdate(entity);
            }
        }

        return entityStore;
    }

    /**
     * Get the normalized entity data store for our `SearchEntityModel`.
     *
     * If our store hasn't seen the entity yet then we'll initialize a store with the
     * `SearchEntityModel`'s `initialData`.
     *
     * If our store has seen the entity but our `SearchEntityModel`'s `initialData` is
     * newer than what's in the store, we will immediately update the store with the
     * entity's new data. Updating everywhere the entity is visible in the product.
     *
     * You shouldn't call this in a React render method since it performs a side
     * effect. Instead call `getEntityStore()` which schedules an update for later.
     */
    public getAndImmediatelyUpdateEntityStore(
        newEntity: SearchEntityModel,
    ): Store<SearchEntityModelData> {
        const entityStore = this._getEntityStoreWithoutUpdating(newEntity);

        entityStore.set(oldEntityData =>
            SearchEntityModel.mergeData(oldEntityData, newEntity.initialData),
        );

        return entityStore;
    }

    private _withSetTimeoutSchedulerForTest?: boolean;

    public withSetTimeoutSchedulerForTest() {
        assert(import.meta.jest);
        this._withSetTimeoutSchedulerForTest = true;
    }

    private _scheduleEntityUpdate(entity: SearchEntityModel) {
        assert(typeof window !== "undefined");

        if (this._entityUpdatesScheduledDuringRun >= 20) {
            this._entityUpdatesScheduledDuringRun = 0;
            throw new InternalError(
                "`SearchEntityRegistry._runScheduledEntityUpdates()` scheduled new updates 20 times in a loop, there\u2019s likely an update cycle",
            );
        }

        if (this._scheduledEntityUpdates !== null) {
            this._scheduledEntityUpdates.add(entity);
        } else {
            this._scheduledEntityUpdates = new Set([entity]);

            if (import.meta.jest && this._withSetTimeoutSchedulerForTest) {
                // Allow unit tests to use `setTimeout()` as the scheduler so we can use Jest fake
                // timers.
                setTimeout(() => {
                    this._runScheduledEntityUpdates();
                });
            } else {
                // Use the React scheduler to schedule a low priority update. If React is
                // processing user actions then we want that to finish before rendering new
                // accounts.
                unstable_scheduleCallback(unstable_LowPriority, () => {
                    this._runScheduledEntityUpdates();
                });
            }
        }
    }

    private _runScheduledEntityUpdates() {
        const scheduledEntityUpdates = this._scheduledEntityUpdates;
        this._scheduledEntityUpdates = null;
        if (scheduledEntityUpdates === null) return;

        batchStoreUpdates(() => {
            for (const newEntity of scheduledEntityUpdates) {
                this._entityStoreById
                    .get(newEntity.id)
                    ?.set(oldEntityData =>
                        SearchEntityModel.mergeData(oldEntityData, newEntity.initialData),
                    );
            }
        });

        // NOTE(calebmer): Helps detect infinite update cycles. If a listener to one of the
        // stores we updated with the above `set()`s then calls `getEntityStore()` and
        // schedules a new update we might be stuck in an infinite loop!
        //
        // We saw this happen once with task search entities (due to an interaction with
        // the friend store). Our `SearchEntityModel.mergeData()` function had a bug which
        // caused `getEntityStore()` to think it had new data (when it actually had data
        // that equaled what was already in the store) and so it would schedule an update
        // on every React re-render.
        //
        // If we schedule new updates during `_runScheduledEntityUpdates()` more than 20
        // times we'll throw an error instead of silently looping forever.
        if (this._scheduledEntityUpdates !== null) {
            this._entityUpdatesScheduledDuringRun += 1;
        } else {
            this._entityUpdatesScheduledDuringRun = 0;
        }
    }
}
