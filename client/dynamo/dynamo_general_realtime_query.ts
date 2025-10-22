import createTree, {Tree, Iterator as TreeIterator} from "functional-red-black-tree";
import {
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeItem,
    DynamoGeneralRealtimeQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoItemKey, DynamoItemPartitionKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {InternalError, OutOfRangeError} from "~/shared/error/error.js";
import {decodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

type DynamoGeneralRealtimeQueryLoadedPageInfo =
    | {
          readonly type: "FromStart";
          readonly endItemKey: DynamoItemKey;
      }
    | {
          readonly type: "FromEnd";
          readonly startItemKey: DynamoItemKey;
      };

export type DynamoGeneralRealtimeQueryItem<Model, Extra = never> =
    | {
          readonly type: "Loaded";
          readonly item: DynamoGeneralRealtimeItem<Model> & {
              readonly extra: Extra | null;
          };
      }
    | {
          readonly type: "LoadingIndicator";
      };

/**
 * An immutable object representing the client state of a query against a
 * DynamoDB realtime table. Handles loading pages fetched from the server with
 * eventual consistency and receiving realtime events out-of-order.
 *
 * Realtime queries should be eventually correct within a few seconds.
 */
export class DynamoGeneralRealtimeQuery<Model, Extra = never> {
    /**
     * The partition key this query result is for. A query can only cover one
     * partition. All items will be a part of the same partition.
     */
    private readonly _partitionKey: DynamoItemPartitionKey;

    /**
     * The inclusive upper bound of items we should expect in this query. If an
     * item with this key exists then it'll be included in the query.
     */
    private readonly _startItemKey: DynamoItemKey | null;

    /**
     * The inclusive lower bound of items we should expect in this query. If an
     * item with this key exists then it'll be included in the query.
     */
    private readonly _endItemKey: DynamoItemKey | null;

    /**
     * All items we currently know about in our query in order. Items are ordered
     * by the lexicographic order of their keys. We use a binary tree to maintain
     * the order of our items while allowing for efficient, immutable, updates.
     *
     * May contain items outside of the "loaded page". The loaded page is the slice
     * of the query where we know the client has all items. This is what we return
     * from `getItem()`. We include items outside of the loaded page since we may
     * receive realtime events out of order. See the documentation on
     * `loadedPageInfo` for an example. The loaded page is determined by
     * `loadedPageItemSlice`.
     */
    private readonly _itemByKey: Tree<
        DynamoItemKey,
        DynamoGeneralRealtimeItem<Model> & {
            // Allow clients to add extra data to each item.
            readonly extra: Extra | null;
        }
    >;

    /**
     * A map of items that have been deleted and at what version they were deleted.
     * We need to keep track of deleted items in our query since we receive
     * realtime events out-of-order. If a user updates an item to V+1 then deletes
     * the item (which sets the version in its gravestone to V+2) and our client
     * receives the V+2 delete event before the V+1 update event then we need to
     * ignore the V+1 update.
     */
    private readonly _deletedItemByKey: ImmutableMap<DynamoItemKey, {readonly version: number}>;

    /**
     * Information about the page of data loaded in this query so far. If null
     * we've loaded the entire query! Nothing is outside our loaded window.
     *
     * We can either be loading data starting from the top of the query or starting
     * from the end of the query. This determines where the loading spinner
     * appears in the resulting list.
     *
     * Our realtime system guarantees that data within the loaded page is
     * eventually correct within a couple seconds. (If you're receiving all the
     * relevant realtime events that is.)
     *
     * We may receive items from realtime that are outside of the loaded page. We
     * keep them around in our query in case we load more data and the data is
     * behind an event we received in realtime. Consider:
     *
     * 1. We start loading a query of items N through N+10
     * 2. As a part of the query, the server loads item N+2 at version V
     * 3. User updates item N+2 to version V+1
     * 4. We receive a realtime update for item N+2 as version V+1
     * 5. We receive the data from the server for items N through N+10 where item
     *    N+2 is version V
     *
     * In this case we don't want to throw away the realtime update we got in step
     * 4 since we will need to apply it after step 5. So our solution is to keep
     * the item around in our list data structure but not render it.
     */
    private readonly _loadedPageInfo: DynamoGeneralRealtimeQueryLoadedPageInfo | null;

    /**
     * This is a mutable piece of state inside our otherwise immutable data type.
     * A functional programming sin! However, we do it since it's practical.
     *
     * The `ServerSynchronizationCheckpoint` tells us how up-to-date our client's
     * realtime data is based on what's on the server. When we backfill realtime
     * events we send our checkpoint to the server and the server will return all
     * realtime events that happened between the checkpoint and now. So for example
     * if our WebSocket disconnects for two minutes because the user lost internet,
     * when the WebSocket reconnects we'll send the last checkpoint we had from the
     * server (which is the time two minutes ago) and receive all realtime events
     * we missed while we were disconnected.
     *
     * The `ServerSynchronizationCheckpoint` is set:
     *
     * 1. When we initially load data.
     *
     * 2. Every `Ping`/`Pong` message from our WebSocket server. Since while we're
     *    connected to the WebSocket server we know we're seeing all realtime
     *    events. As soon as the WebSocket disconnects (and we stop receiving
     *    `Pong` messages) our client data may be falling out-of-date with the
     *    server since there's realtime events we're not seeing.
     *
     * We ping the WebSocket server every minute. If this were an immutable
     * property on the list we'd end up re-rendering the entire view
     * depending on this list once per minute. Which feels inefficient. Especially
     * if the user is actively interacting with the view and we block some other
     * update.
     *
     * Instead, we update a mutable property on the data type. This makes the data
     * type "impure" in a functional programming sense but it's fine, we're not
     * caching and reusing these objects. Making this a mutable property may be a
     * premature optimization but mutability just doesn't seem like a big
     * deal here.
     */
    private _mutableCheckpoint: ServerSynchronizationCheckpoint;

    private constructor({
        partitionKey,
        startItemKey,
        endItemKey,
        itemByKey,
        deletedItemByKey,
        loadedPageInfo,
        mutableCheckpoint,
    }: {
        partitionKey: DynamoItemPartitionKey;
        startItemKey: DynamoItemKey | null;
        endItemKey: DynamoItemKey | null;
        itemByKey: Tree<
            DynamoItemKey,
            DynamoGeneralRealtimeItem<Model> & {
                // Allow clients to add extra data to each item.
                readonly extra: Extra | null;
            }
        >;
        deletedItemByKey: ImmutableMap<DynamoItemKey, {readonly version: number}>;
        loadedPageInfo: DynamoGeneralRealtimeQueryLoadedPageInfo | null;
        mutableCheckpoint: ServerSynchronizationCheckpoint;
    }) {
        // Run some data validity assertions to verify assumptions about our data in
        // development and test environments but not in production since these
        // assertions can be expensive.
        if (process.env.NODE_ENV !== "production") {
            assert(
                iterableEvery(deletedItemByKey.keys(), key => itemByKey.get(key) === undefined),
                "Expected all keys in `deletedItemByKey` not to exist in `itemByKey`",
            );

            assert(
                iterableEvery(iterateTreeEntries(itemByKey), ([key]) => {
                    return (
                        deletedItemByKey.get(key) === undefined &&
                        (startItemKey === null || startItemKey <= key) &&
                        (endItemKey === null || key <= endItemKey)
                    );
                }),
                "Expected all keys in `itemByKey` not to exist in `deletedItemByKey` and for all keys to be in bounds",
            );
        }

        this._partitionKey = partitionKey;
        this._startItemKey = startItemKey;
        this._endItemKey = endItemKey;
        this._itemByKey = itemByKey;
        this._deletedItemByKey = deletedItemByKey;
        this._loadedPageInfo = loadedPageInfo;
        this._mutableCheckpoint = mutableCheckpoint;
    }

    /**
     * Initialize our immutable query data type with a query result.
     *
     * Does not currently support initializing data in the middle of the query.
     */
    public static new<Model, Extra = never>(
        result: DynamoGeneralRealtimeQueryResult<Model>,
    ): DynamoGeneralRealtimeQuery<Model, Extra> {
        let itemByKey = createTree<
            DynamoItemKey,
            DynamoGeneralRealtimeItem<Model> & {
                readonly extra: Extra | null;
            }
        >();

        let startItemKey = result.startItemKey;
        let endItemKey = result.endItemKey;

        for (const item of result.items) {
            itemByKey = itemByKey.insert(item.key, {...item, extra: null});
        }

        let loadedPageInfo: DynamoGeneralRealtimeQueryLoadedPageInfo | null;

        switch (result.pageInfo.type) {
            case "FromStart": {
                const lastItem =
                    result.items.length > 0 ? result.items[result.items.length - 1] : null;

                if (!result.pageInfo.hasNextPage || !lastItem) {
                    loadedPageInfo = null;
                } else {
                    loadedPageInfo = {type: "FromStart", endItemKey: lastItem.key};
                }

                // If we initialized our query with a page starting after a certain cursor then
                // that cursor is our actual start bound.
                //
                // We don't currently support initializing in the middle of a query.
                if (
                    result.pageInfo.afterItemKey !== null &&
                    (startItemKey === null || result.pageInfo.afterItemKey > startItemKey)
                ) {
                    startItemKey = result.pageInfo.afterItemKey;
                }
                break;
            }
            case "FromEnd": {
                const firstItem = result.items.length > 0 ? result.items[0]! : null;

                if (!result.pageInfo.hasPreviousPage || !firstItem) {
                    loadedPageInfo = null;
                } else {
                    loadedPageInfo = {type: "FromEnd", startItemKey: firstItem.key};
                }

                // If we initialized our query with a page starting before a certain cursor
                // then that cursor is our actual end bound.
                //
                // We don't currently support initializing in the middle of a query.
                if (
                    result.pageInfo.beforeItemKey !== null &&
                    (endItemKey === null || result.pageInfo.beforeItemKey < endItemKey)
                ) {
                    endItemKey = result.pageInfo.beforeItemKey;
                }
                break;
            }
            default:
                throw exhaustive(result.pageInfo);
        }

        return new DynamoGeneralRealtimeQuery({
            partitionKey: result.partitionKey,
            startItemKey,
            endItemKey,
            itemByKey,
            deletedItemByKey: ImmutableMap.empty(),
            loadedPageInfo,
            mutableCheckpoint: result.checkpoint,
        });
    }

    /**
     * Loads more data into the query. Only adds items to the loaded page if the
     * new query result overlaps with data we already have.
     */
    public loadMore(
        result: Omit<DynamoGeneralRealtimeQueryResult<Model>, "checkpoint">,
    ): DynamoGeneralRealtimeQuery<Model, Extra> {
        return DynamoGeneralRealtimeQuery._loadMore(this, result);
    }

    // Use a static method so we can reassign `this` within the function.
    private static _loadMore<Model, Extra>(
        query: DynamoGeneralRealtimeQuery<Model, Extra>,
        result: Omit<DynamoGeneralRealtimeQueryResult<Model>, "checkpoint">,
    ): DynamoGeneralRealtimeQuery<Model, Extra> {
        if (query._partitionKey !== result.partitionKey) {
            throw new InternalError("Tried to load more data from a different table partition");
        }

        query = query._putItems(
            filterMapIterable(result.items, item => {
                const isInRange =
                    (query._startItemKey === null || item.key >= query._startItemKey) &&
                    (query._endItemKey === null || item.key <= query._endItemKey);

                // Ignore items that aren't in our query's range. An item's primary key will
                // never change so we don't need to store the item in a `itemVisibilityByKey`
                // map with `isVisible: false` like we need to in
                // `DynamoGeneralRealtimeIndexQuery`.
                if (!isInRange) return;

                return {
                    isDeleted: false,
                    item,
                };
            }),
        );

        let loadedPageInfo = query._loadedPageInfo;

        // Update the loaded page if our new page extends its bounds. That means the
        // new page should start within the loaded page and should end outside of the
        // loaded page.
        switch (result.pageInfo.type) {
            case "FromStart": {
                const lastItem =
                    result.items.length > 0 ? result.items[result.items.length - 1]! : null;

                if (query._loadedPageInfo?.type === "FromStart") {
                    const resultStartItemKey =
                        result.pageInfo.afterItemKey !== null &&
                        result.startItemKey !== null &&
                        result.startItemKey > result.pageInfo.afterItemKey
                            ? result.startItemKey
                            : result.pageInfo.afterItemKey ?? result.startItemKey;

                    if (
                        resultStartItemKey === null ||
                        resultStartItemKey <= query._loadedPageInfo.endItemKey
                    ) {
                        loadedPageInfo =
                            lastItem && result.pageInfo.hasNextPage
                                ? {
                                      type: "FromStart",
                                      endItemKey: lastItem.key,
                                  }
                                : null;
                    }
                }
                break;
            }
            case "FromEnd": {
                const firstItem = result.items.length > 0 ? result.items[0]! : null;

                if (query._loadedPageInfo?.type === "FromEnd") {
                    const resultEndItemKey =
                        result.pageInfo.beforeItemKey !== null &&
                        result.endItemKey !== null &&
                        result.endItemKey < result.pageInfo.beforeItemKey
                            ? result.endItemKey
                            : result.pageInfo.beforeItemKey ?? result.endItemKey;

                    if (
                        resultEndItemKey === null ||
                        resultEndItemKey >= query._loadedPageInfo.startItemKey
                    ) {
                        loadedPageInfo =
                            firstItem && result.pageInfo.hasPreviousPage
                                ? {
                                      type: "FromEnd",
                                      startItemKey: firstItem.key,
                                  }
                                : null;
                    }
                }
                break;
            }
            default:
                throw exhaustive(result.pageInfo);
        }

        // Optimization: If nothing changed, don't update our instance.
        if (loadedPageInfo === query._loadedPageInfo) return query;

        return new DynamoGeneralRealtimeQuery({
            partitionKey: query._partitionKey,
            startItemKey: query._startItemKey,
            endItemKey: query._endItemKey,
            itemByKey: query._itemByKey,
            deletedItemByKey: query._deletedItemByKey,
            loadedPageInfo,
            mutableCheckpoint: query._mutableCheckpoint,
        });
    }

    /**
     * Handles realtime events from the server and incorporates them into our
     * query. Will correctly handle events received out-of-order.
     */
    public handleEventTransaction(
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>,
    ): DynamoGeneralRealtimeQuery<Model, Extra> {
        const partitionKeyBytes = decodeBase64(
            this._partitionKey,
            "Rfc4648UrlWithOrderPreservation",
        );

        return this._putItems(
            filterMapIterable(eventTransaction, event => {
                switch (event.type) {
                    case "PutItem": {
                        const isInRange =
                            (this._startItemKey === null || event.item.key >= this._startItemKey) &&
                            (this._endItemKey === null || event.item.key <= this._endItemKey);

                        // Ignore items that aren't in our query's range. An item's primary key will
                        // never change so we don't need to store the item in a `itemVisibilityByKey`
                        // map with `isVisible: false` like we need to in
                        // `DynamoGeneralRealtimeIndexQuery`.
                        if (!isInRange) {
                            return;
                        }

                        const keyBytes = decodeBase64(
                            event.item.key,
                            "Rfc4648UrlWithOrderPreservation",
                        );

                        // Is `partitionKeyBytes` a prefix of `keyBytes`? If not then this event isn't
                        // relevant to the query.
                        for (let i = 0; i < partitionKeyBytes.length; i++) {
                            if (partitionKeyBytes[i] !== keyBytes[i]) {
                                return;
                            }
                        }

                        return {
                            isDeleted: false,
                            partitionKey: this._partitionKey,
                            // Items outside of our index will not have the `Model` type. We assume the
                            // server implementation is correct and the types will all work out.
                            item: event.item as DynamoGeneralRealtimeItem<Model>,
                        };
                    }
                    case "DeleteItem": {
                        const isInRange =
                            (this._startItemKey === null || event.item.key >= this._startItemKey) &&
                            (this._endItemKey === null || event.item.key <= this._endItemKey);

                        // Ignore items that aren't in our query's range. An item's primary key will
                        // never change so we don't need to store the item in a `itemVisibilityByKey`
                        // map with `isVisible: false` like we need to in
                        // `DynamoGeneralRealtimeIndexQuery`.
                        if (!isInRange) {
                            return;
                        }

                        const keyBytes = decodeBase64(
                            event.item.key,
                            "Rfc4648UrlWithOrderPreservation",
                        );

                        // Is `partitionKeyBytes` a prefix of `keyBytes`? If not then this event isn't
                        // relevant to the query.
                        for (let i = 0; i < partitionKeyBytes.length; i++) {
                            if (partitionKeyBytes[i] !== keyBytes[i]) {
                                return;
                            }
                        }

                        return {
                            isDeleted: true,
                            item: event.item,
                        };
                    }
                    default:
                        throw exhaustive(event);
                }
            }),
        );
    }

    private _putItems(
        itemEntries: Iterable<
            | {
                  isDeleted: false;
                  item: DynamoGeneralRealtimeItem<Model>;
              }
            | {
                  isDeleted: true;
                  item: {
                      key: DynamoItemKey;
                      version: number;
                  };
              }
        >,
    ): DynamoGeneralRealtimeQuery<Model, Extra> {
        let itemByKey = this._itemByKey;
        let deletedItemByKey = this._deletedItemByKey;

        for (const itemEntry of itemEntries) {
            // Make sure the item is in our query's range. Any items not in our query's
            // range should have been filtered out before calling `_putItems()`.
            if (process.env.NODE_ENV !== "production") {
                const isInRange =
                    (this._startItemKey === null || itemEntry.item.key >= this._startItemKey) &&
                    (this._endItemKey === null || itemEntry.item.key <= this._endItemKey);

                assert(isInRange);

                // Quick, hacky, check that `this._partitionKey` is the prefix of
                // `itemEntry.item.key` without decoding base64 data. This won't check the last
                // 6 bits of the partition key are the same as the item key.
                //
                // Callers to `_putItems()` should make sure that `this._partitionKey` is
                // actually a prefix of `itemEntry.item.key`.
                assert(itemEntry.item.key.startsWith(this._partitionKey.slice(0, -1)));
            }

            const oldItemIterator = itemByKey.find(itemEntry.item.key);
            const oldDeletedItem =
                oldItemIterator.value === undefined
                    ? deletedItemByKey.get(itemEntry.item.key)
                    : undefined;

            if (oldItemIterator.value === undefined && oldDeletedItem === undefined) {
                if (itemEntry.isDeleted === false) {
                    itemByKey = itemByKey.insert(itemEntry.item.key, {
                        ...itemEntry.item,
                        extra: null,
                    });
                } else {
                    deletedItemByKey = deletedItemByKey.set(itemEntry.item.key, {
                        version: itemEntry.item.version,
                    });
                }
            } else {
                const oldItemVersion = assertExists(
                    oldItemIterator.value ?? oldDeletedItem,
                ).version;

                // We may receive items out-of-order. Only put the latest the version of the
                // item in our query.
                if (oldItemVersion < itemEntry.item.version) {
                    if (itemEntry.isDeleted === false) {
                        if (oldItemIterator.value !== undefined) {
                            itemByKey = oldItemIterator.update({
                                ...itemEntry.item,
                                // Preserve the `extra` data currently in our query object.
                                extra: oldItemIterator.value.extra,
                            });
                        } else {
                            itemByKey = itemByKey.insert(itemEntry.item.key, {
                                ...itemEntry.item,
                                extra: null,
                            });
                            deletedItemByKey = deletedItemByKey.delete(itemEntry.item.key);
                        }
                    } else {
                        if (oldItemIterator.value !== undefined) {
                            itemByKey = oldItemIterator.remove();
                            deletedItemByKey = deletedItemByKey.set(itemEntry.item.key, {
                                version: itemEntry.item.version,
                            });
                        } else {
                            deletedItemByKey = deletedItemByKey.set(itemEntry.item.key, {
                                version: itemEntry.item.version,
                            });
                        }
                    }
                }
            }
        }

        // Optimization: If nothing changed, don't create a new instance.
        if (itemByKey === this._itemByKey && deletedItemByKey === this._deletedItemByKey) {
            return this;
        }

        return new DynamoGeneralRealtimeQuery({
            partitionKey: this._partitionKey,
            startItemKey: this._startItemKey,
            endItemKey: this._endItemKey,
            itemByKey,
            deletedItemByKey,
            loadedPageInfo: this._loadedPageInfo,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    /**
     * Slice of `itemByKey` that is in our loaded page. Returns null if all
     * items are visible (or if there are no items).
     *
     * Inclusive of `startIndex`. Exclusive of `endIndex`.
     *
     * Lazily computed and cached as an optimization.
     */
    private readonly _loadedPageItemSlice = new Lazy<{
        readonly startIndex: number;
        readonly endIndex: number;
    } | null>(() => {
        if (!this._loadedPageInfo) return null;

        switch (this._loadedPageInfo.type) {
            case "FromStart": {
                const iterator = this._itemByKey.find(this._loadedPageInfo.endItemKey);
                assert(iterator.node);

                return {
                    startIndex: 0,
                    endIndex: this._getIteratorIndex(iterator) + 1,
                };
            }
            case "FromEnd": {
                const iterator = this._itemByKey.find(this._loadedPageInfo.startItemKey);
                assert(iterator.node);

                return {
                    startIndex: this._getIteratorIndex(iterator),
                    endIndex: this._itemByKey.root!._count,
                };
            }
            default:
                throw exhaustive(this._loadedPageInfo);
        }
    });

    /**
     * All loaded items in our query in order.
     *
     * The underlying query object's item tree contains unloaded items so we can
     * properly resolve realtime updates. This function removes those unloaded
     * bookkeeping items.
     */
    public getLoadedItemByKey(): Tree<
        DynamoItemKey,
        DynamoGeneralRealtimeItem<Model> & {
            readonly cursor?: undefined;
            readonly extra: Extra | null;
        }
    > {
        if (this._loadedPageInfo === null) return this._itemByKey;

        switch (this._loadedPageInfo.type) {
            case "FromStart": {
                let loadedItemByKey = this._itemByKey;
                let iterator = loadedItemByKey.end;

                // Remove items that are out of the loaded range until we find the last item in
                // the loaded range.
                while (iterator.valid) {
                    const key = iterator.key!;

                    if (key <= this._loadedPageInfo.endItemKey) {
                        break;
                    }

                    loadedItemByKey = iterator.remove();
                    iterator = loadedItemByKey.end;
                }

                return loadedItemByKey;
            }
            case "FromEnd": {
                let loadedItemByKey = this._itemByKey;
                let iterator = loadedItemByKey.begin;

                // Remove items that are out of the loaded range until we find the first item
                // in the loaded range.
                while (iterator.valid) {
                    const cursor = iterator.key!;

                    if (cursor >= this._loadedPageInfo.startItemKey) {
                        break;
                    }

                    loadedItemByKey = iterator.remove();
                    iterator = loadedItemByKey.begin;
                }

                return loadedItemByKey;
            }
            default:
                throw exhaustive(this._loadedPageInfo);
        }
    }

    private _getIteratorIndex(
        iterator: TreeIterator<
            DynamoItemKey,
            DynamoGeneralRealtimeItem<Model> & {
                readonly extra: Extra | null;
            }
        >,
    ): number {
        assert(iterator.node);

        let index = iterator.node.left?._count ?? 0;
        for (let i = iterator._stack.length - 2; i >= 0; i--) {
            const parentNode = iterator._stack[i]!;

            if (parentNode.key < iterator.node.key) {
                index += 1;
                index += parentNode.left?._count ?? 0;
            }
        }

        return index;
    }

    /**
     * Get the number of items rendered by our query. So may include one item for a
     * loading indicator at the top or bottom of the query if we haven't loaded all
     * our data yet.
     */
    public getItemCount(): number {
        return this.getItemCountWithoutLoadingIndicator() + (this._loadedPageInfo ? 1 : 0);
    }

    /**
     * Get the number of items rendered by our query. Not including the loading
     * indicator item we render when we don't have a full list.
     */
    public getItemCountWithoutLoadingIndicator(): number {
        const loadedPageItemSlice = this._loadedPageItemSlice.get();
        return loadedPageItemSlice
            ? loadedPageItemSlice.endIndex - loadedPageItemSlice.startIndex
            : this._itemByKey.length;
    }

    // Optimization: If you are calling `getItem()` in sequence
    // (`getItem(N)`, `getItem(N + 1)`, `getItem(N + 2)`, `getItem(N + 3)`, etc.)
    // then we maintain a mutable iterator so your sequential `getItem()` calls are
    // O(1) instead of O(log(n)).
    private _getItemIterator: {
        index: number;
        iterator: TreeIterator<
            DynamoItemKey,
            DynamoGeneralRealtimeItem<Model> & {
                readonly extra: Extra | null;
            }
        >;
    } | null = null;

    /**
     * Get the item at the provided index.
     */
    public getItem(index: number): DynamoGeneralRealtimeQueryItem<Model, Extra> {
        if (this._loadedPageInfo) {
            switch (this._loadedPageInfo.type) {
                case "FromStart": {
                    if (index === this.getItemCount() - 1) {
                        return {type: "LoadingIndicator"};
                    }
                    break;
                }
                case "FromEnd": {
                    if (index === 0) {
                        return {type: "LoadingIndicator"};
                    }

                    // The item indexes are all offset by 1 if we start with a loading indicator.
                    index -= 1;
                    break;
                }
                default:
                    throw exhaustive(this._loadedPageInfo);
            }
        }

        const loadedPageItemSlice = this._loadedPageItemSlice.get();

        // If our slice starts at index N then getting the item at position 2 should
        // load the actual item at position N+2.
        index += loadedPageItemSlice ? loadedPageItemSlice.startIndex : 0;

        // Make sure our index is in the slice bounds...
        if (
            loadedPageItemSlice &&
            (index < loadedPageItemSlice.startIndex || loadedPageItemSlice.endIndex < index)
        ) {
            throw new OutOfRangeError("Index out of bounds");
        }

        if (this._getItemIterator !== null && this._getItemIterator.index === index - 1) {
            this._getItemIterator.index += 1;
            this._getItemIterator.iterator.next();
            const iterator = this._getItemIterator.iterator;
            assert(iterator.value);
            return {
                type: "Loaded",
                item: iterator.value,
            };
        } else {
            const iterator = this._itemByKey.at(index);
            assert(iterator.value);

            this._getItemIterator = {
                index,
                iterator,
            };

            return {
                type: "Loaded",
                item: iterator.value,
            };
        }
    }

    /**
     * Get an item by its key if it exists in the query and is loaded.
     */
    public getItemByKeyIfExists(key: DynamoItemKey): {
        readonly index: number;
        readonly item: DynamoGeneralRealtimeItem<Model> & {
            readonly extra: Extra | null;
        };
    } | null {
        const iterator = this._itemByKey.find(key);
        assert(iterator.value);

        return {
            index: this._getIteratorIndex(iterator),
            item: iterator.value,
        };
    }

    /**
     * Gets the first loaded item in the query if there are items in the query.
     */
    public getFirstItemIfExists(): DynamoGeneralRealtimeItem<Model> | null {
        if (this._itemByKey.length === 0) return null;

        const loadedPageItemSlice = this._loadedPageItemSlice.get();
        return this._itemByKey.at(loadedPageItemSlice?.startIndex ?? 0).value ?? null;
    }

    /**
     * Gets the first loaded item in the query if there are items in the query.
     */
    public getLastItemIfExists(): DynamoGeneralRealtimeItem<Model> | null {
        if (this._itemByKey.length === 0) return null;

        const loadedPageItemSlice = this._loadedPageItemSlice.get();
        return (
            this._itemByKey.at(
                loadedPageItemSlice ? loadedPageItemSlice.endIndex - 1 : this._itemByKey.length - 1,
            ).value ?? null
        );
    }

    /**
     * Get the item after the provided cursor if an item exists.
     */
    public getItemAfterKeyIfExists(key: DynamoItemKey): DynamoGeneralRealtimeItem<Model> | null {
        const iterator = this._itemByKey.gt(key);
        if (!iterator.value) return null;

        const index = this._getIteratorIndex(iterator);
        const loadedPageItemSlice = this._loadedPageItemSlice.get();

        // Make sure our current item and the next item (`index + 1`) are in our loaded
        // items range.
        if (
            loadedPageItemSlice &&
            (index < loadedPageItemSlice.startIndex || loadedPageItemSlice.endIndex < index)
        ) {
            return null;
        }

        return iterator.value;
    }

    /**
     * Get the item before the provided cursor if an item exists.
     */
    public getItemBeforeKeyIfExists(key: DynamoItemKey): DynamoGeneralRealtimeItem<Model> | null {
        const iterator = this._itemByKey.lt(key);
        if (!iterator.value) return null;

        const index = this._getIteratorIndex(iterator);
        const loadedPageItemSlice = this._loadedPageItemSlice.get();

        // Make sure our current item and the next item (`index - 1`) are in our loaded
        // items range.
        if (
            loadedPageItemSlice &&
            (index < loadedPageItemSlice.startIndex || loadedPageItemSlice.endIndex < index)
        ) {
            return null;
        }

        return iterator.value;
    }

    /**
     * Do we have a loading indicator at the end of this query?
     */
    public hasLoadingIndicatorAtEnd(): boolean {
        return this._loadedPageInfo?.type === "FromStart";
    }

    /**
     * Do we have a loading indicator at the start of this query?
     */
    public hasLoadingIndicatorAtStart(): boolean {
        return this._loadedPageInfo?.type === "FromEnd";
    }

    /**
     * Is the loading indicator visible in the provided range of items?
     */
    public isLoadingIndicatorVisible(range: {startIndex: number; endIndex: number}): boolean {
        if (!this._loadedPageInfo) return false;

        let index;

        switch (this._loadedPageInfo.type) {
            case "FromStart":
                index = this.getItemCount() - 1;
                break;
            case "FromEnd":
                index = 0;
                break;

            default:
                throw exhaustive(this._loadedPageInfo);
        }

        return range.startIndex <= index && index <= range.endIndex;
    }

    public getNextPageItemKeyIfExists(): DynamoItemKey | null {
        if (this._loadedPageInfo?.type !== "FromStart") return null;
        return this._loadedPageInfo.endItemKey;
    }

    public getPreviousPageItemKeyIfExists(): DynamoItemKey | null {
        if (this._loadedPageInfo?.type !== "FromEnd") return null;
        return this._loadedPageInfo.startItemKey;
    }

    /**
     * Get the current mutable checkpoint property.
     */
    public getMutableCheckpoint(): ServerSynchronizationCheckpoint {
        return this._mutableCheckpoint;
    }

    /**
     * Set the mutable checkpoint property on this query object. Noops if the
     * provided `checkpoint` is older than the current checkpoint.
     */
    public setMutableCheckpoint(checkpoint: ServerSynchronizationCheckpoint): void {
        this._mutableCheckpoint =
            this._mutableCheckpoint.getTime() < checkpoint.getTime()
                ? checkpoint
                : this._mutableCheckpoint;
    }

    /**
     * Set the `extra` property for the provided item. The `extra` property allows
     * the client to attach some extra client-only data to an item in the query.
     * For instance, channels attach the realtime comment data of a post in the
     * `extra` property.
     *
     * You may update the `extra` of an item outside the loaded range with this
     * method if the item exists in our query. (Because realtime has told us about
     * it.)
     */
    public updateItemExtraByKeyIfExists(
        key: DynamoItemKey,
        update: (
            item: DynamoGeneralRealtimeItem<Model> & {readonly extra: Extra | null},
        ) => Extra | null,
    ): DynamoGeneralRealtimeQuery<Model, Extra> {
        let itemByKey = this._itemByKey;

        const iterator = itemByKey.find(key);
        if (iterator.value === undefined) return this;

        const newExtra = update(iterator.value);
        if (newExtra === iterator.value.extra) return this;

        itemByKey = iterator.update({
            ...iterator.value,
            extra: newExtra,
        });

        return new DynamoGeneralRealtimeQuery({
            partitionKey: this._partitionKey,
            startItemKey: this._startItemKey,
            endItemKey: this._endItemKey,
            itemByKey,
            deletedItemByKey: this._deletedItemByKey,
            loadedPageInfo: this._loadedPageInfo,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    /**
     * Update the `extra` property of every item in the query.
     *
     * Includes items outside of the query's loaded range. There may be items
     * outside of the query's loaded range that realtime tells us about.
     */
    public updateAllItemExtras(
        update: (
            item: DynamoGeneralRealtimeItem<Model> & {readonly extra: Extra | null},
        ) => Extra | null,
    ): DynamoGeneralRealtimeQuery<Model, Extra> {
        let itemByKey = this._itemByKey;

        let iterator = itemByKey.begin;
        while (iterator.value) {
            const newExtra = update(iterator.value);
            if (newExtra === iterator.value.extra) {
                iterator.next();
                continue;
            }

            itemByKey = iterator.update({
                ...iterator.value,
                extra: newExtra,
            });
            iterator = itemByKey.find(iterator.key!);
            iterator.next();
        }

        // Optimization: Nothing changed, return a referentially equal query.
        if (itemByKey === this._itemByKey) return this;

        return new DynamoGeneralRealtimeQuery({
            partitionKey: this._partitionKey,
            startItemKey: this._startItemKey,
            endItemKey: this._endItemKey,
            itemByKey,
            deletedItemByKey: this._deletedItemByKey,
            loadedPageInfo: this._loadedPageInfo,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }
}

function* iterateTreeEntries<Key, Value>(tree: Tree<Key, Value>): IterableIterator<[Key, Value]> {
    const iterator = tree.begin;

    while (iterator.valid) {
        yield [iterator.key!, iterator.value!];
        iterator.next();
    }
}
