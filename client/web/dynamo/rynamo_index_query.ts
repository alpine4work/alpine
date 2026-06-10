import createTree, {Tree, Iterator as TreeIterator} from "functional-red-black-tree";
import {
    DynamoIndexCursor,
    DynamoIndexPartitionKey,
    DynamoItemKey,
} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {RynamoEvent, RynamoIndexQueryResult, RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {InternalError, OutOfRangeError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {symmetricDiffTree} from "~/shared/helpers/immutable/symmetric_diff_tree.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

type RynamoIndexQueryLoadedPageInfo =
    | {
          readonly type: "FromStart";
          readonly endCursor: DynamoIndexCursor;
      }
    | {
          readonly type: "FromEnd";
          readonly startCursor: DynamoIndexCursor;
      };

export type RynamoIndexQueryItem<Model, Extra = never> =
    | {
          readonly type: "Loaded";
          readonly cursor: DynamoIndexCursor;
          readonly item: RynamoItem<Model> & {
              readonly extra: Extra | null;
          };
      }
    | {
          readonly type: "LoadingIndicator";
      };

/**
 * An immutable object representing the client state of a query against an index in
 * a DynamoDB realtime table. Handles loading pages fetched from the server with
 * eventual consistency and receiving realtime events out-of-order.
 *
 * Realtime queries should be eventually correct within a few seconds.
 */
export class RynamoIndexQuery<Model, Extra = never> {
    /**
     * The name of the index we are querying. Cursors are only meaningful for a
     * specific index. Can not load results across indexes.
     *
     * Also helps us interpret realtime events. Realtime events include the cursor for
     * every index the item is in. If the item is not in a given index, it won't have a
     * cursor for that index name so we can ignore it.
     */
    private readonly _indexName: string;

    /**
     * The index partition key this query result is for. An item can only be in one
     * index partition at a time.
     */
    private readonly _partitionKey: DynamoIndexPartitionKey;

    /**
     * The start bound for items in this query. We ignore realtime events for items
     * outside of this bound. If null the query has no starting bound.
     */
    private readonly _startCursorBound: string | null;

    /**
     * The end bound for items in this query. We ignore realtime events for items
     * outside of this bound. If null the query has no ending bound.
     */
    private readonly _endCursorBound: string | null;

    /**
     * All items we currently know about in our query in order.
     *
     * Items are ordered by cursor so we use a binary tree to maintain that order while
     * allowing for efficient, immutable, updates.
     *
     * May contain items outside of the "loaded page". The loaded page is the slice of
     * the query where we know the client has all items. This is what we return from
     * `getItem()`. We include items outside of the loaded page since we may receive
     * realtime events out of order. See the documentation on `loadedPageInfo` for an
     * example. The loaded page is determined by `loadedPageItemSlice`.
     */
    private readonly _itemByCursor: Tree<
        DynamoIndexCursor,
        RynamoItem<Model> & {
            // Remove `cursor` property before adding to this map. It's not strictly necessary
            // but makes debugging a little cleaner.
            readonly cursor?: undefined;
            // Allow clients to add extra data to each item.
            readonly extra: Extra | null;
        }
    >;

    /**
     * A map from item key to item cursor. In case we want to update an item in our
     * list by key and we don't know it's exact position.
     *
     * Also we keep a record of items we've seen but are outside our query's
     * `startCursorBound` and `endCursorBound`. We keep this record in case we receive
     * events out-of-order. Consider an update for an item at version V that updates
     * its name then an update for an item at version V+1 that moves its cursor out of
     * our bounds. If we receive the V+1 realtime event first we hide the item. If we
     * then receive the V realtime event we want to ignore that event and keep the item
     * hidden!
     */
    private readonly _itemVisibilityByKey: ImmutableMap<
        DynamoItemKey,
        | {readonly isVisible: true; readonly cursor: DynamoIndexCursor}
        | {readonly isVisible: false; readonly version: number}
    >;

    /**
     * Information about the page of data loaded in this query so far. If null we've
     * loaded the entire query! Nothing is outside our loaded window.
     *
     * We can either be loading data starting from the top of the query or starting
     * from the end of the query. This determines where the loading spinner appears in
     * the resulting list.
     *
     * Our realtime system guarantees that data within the loaded page is eventually
     * correct within a couple seconds. (If you're receiving all the relevant realtime
     * events that is.)
     *
     * We may receive items from realtime that are outside of the loaded page. We keep
     * them around in our query in case we load more data and the data is behind an
     * event we received in realtime. Consider:
     *
     * 1. We start loading a query of items N through N+10
     * 2. As a part of the query, the server loads item N+2 at version V
     * 3. User updates item N+2 to version V+1
     * 4. We receive a realtime update for item N+2 as version V+1
     * 5. We receive the data from the server for items N through N+10 where item N+2
     *    is version V
     *
     * In this case we don't want to throw away the realtime update we got in step 4
     * since we will need to apply it after step 5. So our solution is to keep the item
     * around in our list data structure but not render it.
     */
    private readonly _loadedPageInfo: RynamoIndexQueryLoadedPageInfo | null;

    /**
     * This is a mutable piece of state inside our otherwise immutable data type. A
     * functional programming sin! However, we do it since it's practical.
     *
     * The `ServerSynchronizationCheckpoint` tells us how up-to-date our client's
     * realtime data is based on what's on the server. When we backfill realtime events
     * we send our checkpoint to the server and the server will return all realtime
     * events that happened between the checkpoint and now. So for example if our
     * WebSocket disconnects for two minutes because the user lost internet, when the
     * WebSocket reconnects we'll send the last checkpoint we had from the server
     * (which is the time two minutes ago) and receive all realtime events we missed
     * while we were disconnected.
     *
     * The `ServerSynchronizationCheckpoint` is set:
     *
     * 1. When we initially load data.
     *
     * 2. Every `Ping`/`Pong` message from our WebSocket server. Since while we're
     *    connected to the WebSocket server we know we're seeing all realtime events.
     *    As soon as the WebSocket disconnects (and we stop receiving `Pong` messages)
     *    our client data may be falling out-of-date with the server since there's
     *    realtime events we're not seeing.
     *
     * We ping the WebSocket server every minute. If this were an immutable property on
     * the list we'd end up re-rendering the entire view depending on this list once
     * per minute. Which feels inefficient. Especially if the user is actively
     * interacting with the view and we block some other update.
     *
     * Instead, we update a mutable property on the data type. This makes the data type
     * "impure" in a functional programming sense but it's fine, we're not caching and
     * reusing these objects. Making this a mutable property may be a premature
     * optimization but mutability just doesn't seem like a big deal here.
     */
    private _mutableCheckpoint: ServerSynchronizationCheckpoint;

    private constructor({
        indexName,
        partitionKey,
        startCursorBound,
        endCursorBound,
        itemByCursor,
        itemVisibilityByKey,
        loadedPageInfo,
        mutableCheckpoint,
    }: {
        indexName: string;
        partitionKey: DynamoIndexPartitionKey;
        startCursorBound: string | null;
        endCursorBound: string | null;
        itemByCursor: Tree<
            DynamoIndexCursor,
            RynamoItem<Model> & {
                readonly cursor?: undefined;
                readonly extra: Extra | null;
            }
        >;
        itemVisibilityByKey: ImmutableMap<
            DynamoItemKey,
            | {readonly isVisible: true; readonly cursor: DynamoIndexCursor}
            | {readonly isVisible: false; readonly version: number}
        >;
        loadedPageInfo: RynamoIndexQueryLoadedPageInfo | null;
        mutableCheckpoint: ServerSynchronizationCheckpoint;
    }) {
        // Run some data validity assertions to verify assumptions about our data in
        // development and test environments but not in production since these assertions
        // can be expensive.
        if (process.env.NODE_ENV !== "production") {
            assert(
                iterableEvery(
                    itemVisibilityByKey,
                    ([key, itemVisibility]) =>
                        !itemVisibility.isVisible ||
                        itemByCursor.get(itemVisibility.cursor)?.key === key,
                ),
                "Expected an entry in `itemByCursor` for every entry in `itemVisibilityByKey`",
            );

            assert(
                iterableEvery(iterateTreeEntries(itemByCursor), ([cursor, item]) => {
                    const itemVisibility = itemVisibilityByKey.get(item.key);
                    return (
                        !!itemVisibility?.isVisible &&
                        itemVisibility.cursor === cursor &&
                        (startCursorBound === null || startCursorBound < cursor) &&
                        (endCursorBound === null || cursor < endCursorBound)
                    );
                }),
                "Expected an entry in `itemVisibilityByKey` for every entry in `itemByCursor` and for all cursors to be in bounds",
            );
        }

        this._indexName = indexName;
        this._partitionKey = partitionKey;
        this._startCursorBound = startCursorBound;
        this._endCursorBound = endCursorBound;
        this._itemByCursor = itemByCursor;
        this._itemVisibilityByKey = itemVisibilityByKey;
        this._loadedPageInfo = loadedPageInfo;
        this._mutableCheckpoint = mutableCheckpoint;
    }

    /**
     * Initialize our immutable query data type with a query result.
     *
     * Does not currently support initializing data in the middle of the query.
     */
    public static new<Model, Extra = never>(
        result: RynamoIndexQueryResult<Model>,
    ): RynamoIndexQuery<Model, Extra> {
        let itemByCursor = createTree<
            DynamoIndexCursor,
            RynamoItem<Model> & {
                readonly cursor?: undefined;
                readonly extra: Extra | null;
            }
        >();

        let itemVisibilityByKey = ImmutableMap.empty<
            DynamoItemKey,
            | {readonly isVisible: true; readonly cursor: DynamoIndexCursor}
            | {readonly isVisible: false; readonly version: number}
        >();

        let startCursorBound = result.startCursorBound;
        let endCursorBound = result.endCursorBound;

        for (const item of result.items) {
            itemVisibilityByKey = itemVisibilityByKey.set(item.key, {
                isVisible: true,
                cursor: item.cursor,
            });
            itemByCursor = itemByCursor.insert(item.cursor, massageRynamoItem(item, null));
        }

        let loadedPageInfo: RynamoIndexQueryLoadedPageInfo | null;

        switch (result.pageInfo.type) {
            case "FromStart": {
                const lastItem =
                    result.items.length > 0 ? result.items[result.items.length - 1] : null;

                if (!result.pageInfo.hasNextPage || !lastItem) {
                    loadedPageInfo = null;
                } else {
                    loadedPageInfo = {type: "FromStart", endCursor: lastItem.cursor};
                }

                // If we initialized our query with a page starting after a certain cursor then
                // that cursor is our actual start bound.
                //
                // We don't currently support initializing in the middle of a query.
                if (
                    result.pageInfo.afterCursor !== null &&
                    (startCursorBound === null || result.pageInfo.afterCursor > startCursorBound)
                ) {
                    startCursorBound = result.pageInfo.afterCursor;
                }
                break;
            }
            case "FromEnd": {
                const firstItem = result.items.length > 0 ? result.items[0]! : null;

                if (!result.pageInfo.hasPreviousPage || !firstItem) {
                    loadedPageInfo = null;
                } else {
                    loadedPageInfo = {type: "FromEnd", startCursor: firstItem.cursor};
                }

                // If we initialized our query with a page starting before a certain cursor then
                // that cursor is our actual end bound.
                //
                // We don't currently support initializing in the middle of a query.
                if (
                    result.pageInfo.beforeCursor !== null &&
                    (endCursorBound === null || result.pageInfo.beforeCursor < endCursorBound)
                ) {
                    endCursorBound = result.pageInfo.beforeCursor;
                }
                break;
            }
            default:
                throw exhaustive(result.pageInfo);
        }

        return new RynamoIndexQuery({
            indexName: result.indexName,
            partitionKey: result.partitionKey,
            startCursorBound,
            endCursorBound,
            itemByCursor,
            itemVisibilityByKey,
            loadedPageInfo,
            mutableCheckpoint: result.checkpoint,
        });
    }

    /**
     * Loads more data into the query. Only adds items to the loaded page if the new
     * query result overlaps with data we already have.
     *
     * Throws an error if the data is from a different index partition.
     */
    public loadMore(
        result: Omit<RynamoIndexQueryResult<Model>, "checkpoint">,
    ): RynamoIndexQuery<Model, Extra> {
        return RynamoIndexQuery._loadMore(this, result);
    }

    // Use a static method so we can reassign `this` within the function.
    private static _loadMore<Model, Extra>(
        query: RynamoIndexQuery<Model, Extra>,
        result: Omit<RynamoIndexQueryResult<Model>, "checkpoint">,
    ): RynamoIndexQuery<Model, Extra> {
        if (query._indexName !== result.indexName) {
            throw new InternalError("Tried to load more data from a different index");
        }
        if (query._partitionKey !== result.partitionKey) {
            throw new InternalError("Tried to load more data from a different index partition");
        }

        query = query._putItems(
            mapIterable(result.items, item => ({
                isDeleted: false,
                partitionKey: query._partitionKey,
                cursor: item.cursor,
                item,
            })),
        );

        let loadedPageInfo = query._loadedPageInfo;

        // Update the loaded page if our new page extends its bounds. That means the new
        // page should start within the loaded page and should end outside of the loaded
        // page.
        switch (result.pageInfo.type) {
            case "FromStart": {
                const lastItem =
                    result.items.length > 0 ? result.items[result.items.length - 1]! : null;

                if (query._loadedPageInfo?.type === "FromStart") {
                    const resultStartCursorBound =
                        result.pageInfo.afterCursor !== null &&
                        result.startCursorBound !== null &&
                        result.startCursorBound > result.pageInfo.afterCursor
                            ? result.startCursorBound
                            : (result.pageInfo.afterCursor ?? result.startCursorBound);

                    if (
                        resultStartCursorBound === null ||
                        resultStartCursorBound <= query._loadedPageInfo.endCursor
                    ) {
                        loadedPageInfo =
                            lastItem && result.pageInfo.hasNextPage
                                ? {
                                      type: "FromStart",
                                      endCursor: lastItem.cursor,
                                  }
                                : null;
                    }
                }
                break;
            }
            case "FromEnd": {
                const firstItem = result.items.length > 0 ? result.items[0]! : null;

                if (query._loadedPageInfo?.type === "FromEnd") {
                    const resultEndCursorBound =
                        result.pageInfo.beforeCursor !== null &&
                        result.endCursorBound !== null &&
                        result.endCursorBound < result.pageInfo.beforeCursor
                            ? result.endCursorBound
                            : (result.pageInfo.beforeCursor ?? result.endCursorBound);

                    if (
                        resultEndCursorBound === null ||
                        resultEndCursorBound >= query._loadedPageInfo.startCursor
                    ) {
                        loadedPageInfo =
                            firstItem && result.pageInfo.hasPreviousPage
                                ? {
                                      type: "FromEnd",
                                      startCursor: firstItem.cursor,
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

        return new RynamoIndexQuery({
            indexName: query._indexName,
            partitionKey: query._partitionKey,
            startCursorBound: query._startCursorBound,
            endCursorBound: query._endCursorBound,
            itemByCursor: query._itemByCursor,
            itemVisibilityByKey: query._itemVisibilityByKey,
            loadedPageInfo,
            mutableCheckpoint: query._mutableCheckpoint,
        });
    }

    /**
     * Handles realtime events from the server and incorporates them into our query.
     * Will correctly handle events received out-of-order.
     */
    public handleEvents(
        events: ReadonlyArray<RynamoEvent<unknown>>,
    ): RynamoIndexQuery<Model, Extra> {
        return this._putItems(
            filterMapIterable(events, event => {
                switch (event.type) {
                    case "PutItem": {
                        const index = event.indexes.get(this._indexName);

                        // This item does not have a cursor for this index so it is not present in the
                        // index.
                        if (index === undefined) return;

                        return {
                            isDeleted: false,
                            // If the item is in a different partition then we need to add the item to our
                            // `itemVisibilityByKey` map with `isVisible` false. Since the index partition key
                            // may change.
                            partitionKey: index.partitionKey,
                            cursor: index.cursor,
                            // Items outside of our index will not have the `Model` type. We assume the server
                            // implementation is correct and the types will all work out.
                            item: event.item as RynamoItem<Model>,
                        };
                    }
                    case "DeleteItem": {
                        // This item is not in this index so we don't have to add a gravestone to this
                        // query.
                        if (!event.indexes.has(this._indexName)) return;

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
                  partitionKey: DynamoIndexPartitionKey;
                  cursor: DynamoIndexCursor;
                  item: {
                      readonly cursor?: DynamoIndexCursor;
                  } & RynamoItem<Model>;
              }
            | {
                  isDeleted: true;
                  item: {
                      key: DynamoItemKey;
                      version: number;
                  };
              }
        >,
    ): RynamoIndexQuery<Model, Extra> {
        let itemByCursor = this._itemByCursor;
        let itemVisibilityByKey = this._itemVisibilityByKey;

        for (const itemEntry of itemEntries) {
            const isVisible =
                !itemEntry.isDeleted &&
                // Make sure the item is in the current partition of the index...
                itemEntry.partitionKey === this._partitionKey &&
                // Make sure the item is in the query's cursor bounds...
                (this._startCursorBound === null || this._startCursorBound < itemEntry.cursor) &&
                (this._endCursorBound === null || itemEntry.cursor < this._endCursorBound);

            const oldItemVisibility = itemVisibilityByKey.get(itemEntry.item.key);

            if (oldItemVisibility === undefined) {
                if (isVisible) {
                    itemByCursor = itemByCursor.insert(
                        itemEntry.cursor,
                        massageRynamoItem(itemEntry.item, null),
                    );
                    itemVisibilityByKey = itemVisibilityByKey.set(itemEntry.item.key, {
                        isVisible: true,
                        cursor: itemEntry.cursor,
                    });
                } else {
                    itemVisibilityByKey = itemVisibilityByKey.set(itemEntry.item.key, {
                        isVisible: false,
                        version: itemEntry.item.version,
                    });
                }
            } else {
                const oldItemVersion = oldItemVisibility.isVisible
                    ? assertExists(itemByCursor.get(oldItemVisibility.cursor)).version
                    : oldItemVisibility.version;

                // We may receive items out-of-order. Only put the latest the version of the item
                // in our query.
                if (oldItemVersion < itemEntry.item.version) {
                    if (isVisible) {
                        if (oldItemVisibility.isVisible) {
                            if (oldItemVisibility.cursor === itemEntry.cursor) {
                                const iterator = itemByCursor.find(itemEntry.cursor);

                                itemByCursor = iterator.update(
                                    massageRynamoItem(
                                        itemEntry.item,
                                        // Preserve the `extra` data currently in our query object.
                                        iterator.value!.extra,
                                    ),
                                );
                            } else {
                                const iterator = itemByCursor.find(oldItemVisibility.cursor);

                                itemByCursor = iterator.remove();
                                itemByCursor = itemByCursor.insert(
                                    itemEntry.cursor,
                                    massageRynamoItem(
                                        itemEntry.item,
                                        // Preserve the `extra` data currently in our query object.
                                        iterator.value!.extra,
                                    ),
                                );

                                itemVisibilityByKey = itemVisibilityByKey.set(itemEntry.item.key, {
                                    isVisible: true,
                                    cursor: itemEntry.cursor,
                                });
                            }
                        } else {
                            itemByCursor = itemByCursor.insert(
                                itemEntry.cursor,
                                massageRynamoItem(itemEntry.item, null),
                            );
                            itemVisibilityByKey = itemVisibilityByKey.set(itemEntry.item.key, {
                                isVisible: true,
                                cursor: itemEntry.cursor,
                            });
                        }
                    } else {
                        if (oldItemVisibility.isVisible) {
                            itemByCursor = itemByCursor.remove(oldItemVisibility.cursor);
                            itemVisibilityByKey = itemVisibilityByKey.set(itemEntry.item.key, {
                                isVisible: false,
                                version: itemEntry.item.version,
                            });
                        } else {
                            itemVisibilityByKey = itemVisibilityByKey.set(itemEntry.item.key, {
                                isVisible: false,
                                version: itemEntry.item.version,
                            });
                        }
                    }
                }
            }
        }

        // Optimization: If nothing changed, don't create a new instance.
        if (
            itemByCursor === this._itemByCursor &&
            itemVisibilityByKey === this._itemVisibilityByKey
        ) {
            return this;
        }

        return new RynamoIndexQuery({
            indexName: this._indexName,
            partitionKey: this._partitionKey,
            startCursorBound: this._startCursorBound,
            endCursorBound: this._endCursorBound,
            itemByCursor,
            itemVisibilityByKey,
            loadedPageInfo: this._loadedPageInfo,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    /**
     * Slice of `itemByCursor` that is in our loaded page. Returns null if all items
     * are visible (or if there are no items).
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
                const iterator = this._itemByCursor.find(this._loadedPageInfo.endCursor);
                assert(iterator.node);

                return {
                    startIndex: 0,
                    endIndex: this._getIteratorIndex(iterator) + 1,
                };
            }
            case "FromEnd": {
                const iterator = this._itemByCursor.find(this._loadedPageInfo.startCursor);
                assert(iterator.node);

                return {
                    startIndex: this._getIteratorIndex(iterator),
                    endIndex: this._itemByCursor.root!._count,
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
    public getLoadedItemByCursor(): Tree<
        DynamoIndexCursor,
        RynamoItem<Model> & {
            readonly cursor?: undefined;
            readonly extra: Extra | null;
        }
    > {
        if (this._loadedPageInfo === null) return this._itemByCursor;

        switch (this._loadedPageInfo.type) {
            case "FromStart": {
                let loadedItemByCursor = this._itemByCursor;
                let iterator = loadedItemByCursor.end;

                // Remove items that are out of the loaded range until we find the last item in the
                // loaded range.
                while (iterator.valid) {
                    const cursor = iterator.key!;

                    if (cursor <= this._loadedPageInfo.endCursor) {
                        break;
                    }

                    loadedItemByCursor = iterator.remove();
                    iterator = loadedItemByCursor.end;
                }

                return loadedItemByCursor;
            }
            case "FromEnd": {
                let loadedItemByCursor = this._itemByCursor;
                let iterator = loadedItemByCursor.begin;

                // Remove items that are out of the loaded range until we find the first item in
                // the loaded range.
                while (iterator.valid) {
                    const cursor = iterator.key!;

                    if (cursor >= this._loadedPageInfo.startCursor) {
                        break;
                    }

                    loadedItemByCursor = iterator.remove();
                    iterator = loadedItemByCursor.begin;
                }

                return loadedItemByCursor;
            }
            default:
                throw exhaustive(this._loadedPageInfo);
        }
    }

    private _getIteratorIndex(
        iterator: TreeIterator<
            DynamoIndexCursor,
            RynamoItem<Model> & {
                readonly cursor?: undefined;
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
     * loading indicator at the top or bottom of the query if we haven't loaded all our
     * data yet.
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
            : this._itemByCursor.length;
    }

    // Optimization: If you are calling `getItem()` in sequence (`getItem(N)`,
    // `getItem(N + 1)`, `getItem(N + 2)`, `getItem(N + 3)`, etc.) then we maintain a
    // mutable iterator so your sequential `getItem()` calls are O(1) instead of
    // O(log(n)).
    private _getItemIterator: {
        index: number;
        iterator: TreeIterator<
            DynamoIndexCursor,
            RynamoItem<Model> & {
                readonly cursor?: undefined;
                readonly extra: Extra | null;
            }
        >;
    } | null = null;

    /**
     * Get the item at the provided index.
     */
    public getItem(index: number): RynamoIndexQueryItem<Model, Extra> {
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

        // If our slice starts at index N then getting the item at position 2 should load
        // the actual item at position N+2.
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
            assert(iterator.node);
            return {
                type: "Loaded",
                cursor: iterator.node.key,
                item: iterator.node.value,
            };
        } else {
            const iterator = this._itemByCursor.at(index);
            assert(iterator.node);

            this._getItemIterator = {
                index,
                iterator,
            };

            return {
                type: "Loaded",
                cursor: iterator.node.key,
                item: iterator.node.value,
            };
        }
    }

    /**
     * Get an item's cursor by its key if the item is in the query's loaded range.
     */
    public getCursorByKeyIfExists(key: DynamoItemKey): DynamoIndexCursor | null {
        const itemVisibility = this._itemVisibilityByKey.get(key);
        if (!itemVisibility?.isVisible) return null;

        // If the item is outside our loaded range then return null.
        if (this._loadedPageInfo !== null) {
            switch (this._loadedPageInfo.type) {
                case "FromStart": {
                    if (itemVisibility.cursor > this._loadedPageInfo.endCursor) {
                        return null;
                    }
                    break;
                }
                case "FromEnd": {
                    if (itemVisibility.cursor < this._loadedPageInfo.startCursor) {
                        return null;
                    }
                    break;
                }
                default:
                    throw exhaustive(this._loadedPageInfo);
            }
        }

        return itemVisibility.cursor;
    }

    /**
     * Get an item by its key if it exists in the query and is loaded.
     */
    public getItemByKeyIfExists(key: DynamoItemKey): {
        readonly index: number;
        readonly cursor: DynamoIndexCursor;
        readonly item: RynamoItem<Model> & {
            readonly extra: Extra | null;
        };
    } | null {
        const cursor = this.getCursorByKeyIfExists(key);
        if (cursor === null) return null;

        const iterator = this._itemByCursor.find(cursor);
        assert(iterator.node);

        return {
            index: this._getIteratorIndex(iterator),
            cursor,
            item: iterator.node.value,
        };
    }

    /**
     * Gets the first loaded item in the query if there are items in the query.
     */
    public getFirstItemIfExists(): RynamoItem<Model> | null {
        if (this._itemByCursor.length === 0) return null;

        const loadedPageItemSlice = this._loadedPageItemSlice.get();
        return this._itemByCursor.at(loadedPageItemSlice?.startIndex ?? 0).value ?? null;
    }

    /**
     * Gets the first loaded item in the query if there are items in the query.
     */
    public getLastItemIfExists(): RynamoItem<Model> | null {
        if (this._itemByCursor.length === 0) return null;

        const loadedPageItemSlice = this._loadedPageItemSlice.get();
        return (
            this._itemByCursor.at(
                loadedPageItemSlice
                    ? loadedPageItemSlice.endIndex - 1
                    : this._itemByCursor.length - 1,
            ).value ?? null
        );
    }

    /**
     * Get the item after the provided cursor if an item exists.
     */
    public getItemAfterCursorIfExists(cursor: DynamoIndexCursor): RynamoItem<Model> | null {
        const iterator = this._itemByCursor.gt(cursor);
        if (!iterator.node) return null;

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

        return iterator.node.value;
    }

    /**
     * Get the item before the provided cursor if an item exists.
     */
    public getItemBeforeCursorIfExists(cursor: DynamoIndexCursor): RynamoItem<Model> | null {
        const iterator = this._itemByCursor.lt(cursor);
        if (!iterator.node) return null;

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

        return iterator.node.value;
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

    public getNextPageCursorIfExists(): DynamoIndexCursor | null {
        if (this._loadedPageInfo?.type !== "FromStart") return null;
        return this._loadedPageInfo.endCursor;
    }

    public getPreviousPageCursorIfExists(): DynamoIndexCursor | null {
        if (this._loadedPageInfo?.type !== "FromEnd") return null;
        return this._loadedPageInfo.startCursor;
    }

    /**
     * Get items that were deleted from the provided `oldQuery` in this query. So any
     * items that were in `oldQuery` but are not in this query.
     */
    public getDeletedItems(oldQuery: RynamoIndexQuery<Model, Extra>): Iterable<{
        readonly index: number;
        readonly cursor: DynamoIndexCursor;
        readonly item: RynamoItem<Model>;
    }> {
        const createdItemKeys = new Set<DynamoItemKey>();
        const deletedOldItemByKey = new Map<
            DynamoItemKey,
            {index: number; cursor: DynamoIndexCursor; item: RynamoItem<Model>}
        >();

        for (const change of symmetricDiffTree(oldQuery._itemByCursor, this._itemByCursor)) {
            switch (change.type) {
                // Ignore...
                case "UpdateEntry": {
                    break;
                }
                // We need to look at create changes because if an item is moved then it will be
                // represented as a delete then a create. We only want items that were deleted. Not
                // items that were moved.
                case "CreateEntry": {
                    createdItemKeys.add(change.newValue.key);
                    deletedOldItemByKey.delete(change.newValue.key);
                    break;
                }
                case "DeleteEntry": {
                    if (!createdItemKeys.has(change.oldValue.key)) {
                        const iterator = oldQuery._itemByCursor.find(change.key);
                        assert(iterator.node);

                        deletedOldItemByKey.set(change.oldValue.key, {
                            index: this._getIteratorIndex(iterator),
                            cursor: change.key,
                            item: change.oldValue,
                        });
                    }
                    break;
                }
                default:
                    throw exhaustive(change);
            }
        }

        return deletedOldItemByKey.values();
    }

    /**
     * Get the current mutable checkpoint property.
     */
    public getMutableCheckpoint(): ServerSynchronizationCheckpoint {
        return this._mutableCheckpoint;
    }

    /**
     * Set the mutable checkpoint property on this query object. Noops if the provided
     * `checkpoint` is older than the current checkpoint.
     */
    public setMutableCheckpoint(checkpoint: ServerSynchronizationCheckpoint): void {
        this._mutableCheckpoint =
            this._mutableCheckpoint.getTime() < checkpoint.getTime()
                ? checkpoint
                : this._mutableCheckpoint;
    }

    /**
     * Set the `extra` property for the provided item. The `extra` property allows the
     * client to attach some extra client-only data to an item in the query. For
     * instance, channels attach the realtime comment data of a post in the `extra`
     * property.
     */
    public updateItemExtraByKeyIfExists(
        key: DynamoItemKey,
        update: (item: RynamoItem<Model> & {readonly extra: Extra | null}) => Extra | null,
    ): RynamoIndexQuery<Model, Extra> {
        const cursor = this.getCursorByKeyIfExists(key);
        if (cursor === null) return this;
        return this.updateItemExtraByCursorIfExists(cursor, update);
    }

    /**
     * Set the `extra` property for the provided item. The `extra` property allows the
     * client to attach some extra client-only data to an item in the query. For
     * instance, channels attach the realtime comment data of a post in the `extra`
     * property.
     *
     * You may update the `extra` of an item outside the loaded range with this method
     * if the item exists in our query. (Because realtime has told us about it.)
     */
    public updateItemExtraByCursorIfExists(
        cursor: DynamoIndexCursor,
        update: (item: RynamoItem<Model> & {readonly extra: Extra | null}) => Extra | null,
    ): RynamoIndexQuery<Model, Extra> {
        let itemByCursor = this._itemByCursor;

        const iterator = itemByCursor.find(cursor);
        if (iterator.value === undefined) return this;

        const newExtra = update(iterator.value);
        if (newExtra === iterator.value.extra) return this;

        itemByCursor = iterator.update({
            ...iterator.value,
            extra: newExtra,
        });

        return new RynamoIndexQuery({
            indexName: this._indexName,
            partitionKey: this._partitionKey,
            startCursorBound: this._startCursorBound,
            endCursorBound: this._endCursorBound,
            itemByCursor,
            itemVisibilityByKey: this._itemVisibilityByKey,
            loadedPageInfo: this._loadedPageInfo,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    /**
     * Update the `extra` property of every item in the query.
     *
     * Includes items outside of the query's loaded range. There may be items outside
     * of the query's loaded range that realtime tells us about.
     */
    public updateAllItemExtras(
        update: (
            item: RynamoItem<Model> & {readonly extra: Extra | null},
            cursor: DynamoIndexCursor,
        ) => Extra | null,
    ): RynamoIndexQuery<Model, Extra> {
        let itemByCursor = this._itemByCursor;

        let iterator = itemByCursor.begin;
        while (iterator.node) {
            const node = iterator.node;

            const newExtra = update(node.value, node.key);
            if (newExtra === node.value.extra) {
                iterator.next();
                continue;
            }

            itemByCursor = iterator.update({
                ...node.value,
                extra: newExtra,
            });
            iterator = itemByCursor.find(node.key);
            iterator.next();
        }

        // Optimization: Nothing changed, return a referentially equal query.
        if (itemByCursor === this._itemByCursor) return this;

        return new RynamoIndexQuery({
            indexName: this._indexName,
            partitionKey: this._partitionKey,
            startCursorBound: this._startCursorBound,
            endCursorBound: this._endCursorBound,
            itemByCursor,
            itemVisibilityByKey: this._itemVisibilityByKey,
            loadedPageInfo: this._loadedPageInfo,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    /**
     * Delete an item in the query if the item exists.
     *
     * If the item updates on the server to a new version any optimistic updates will
     * be completely overwritten. So the next update from the server should also
     * reflect the optimistic update we've made here.
     */
    public optimisticallyDeleteItemByKeyIfExists(
        key: DynamoItemKey,
    ): RynamoIndexQuery<Model, Extra> {
        return this.optimisticallyUpdateItemByKeyIfExists(key, () => null);
    }

    /**
     * Update an item in the query if the item exists.
     *
     * If `update` returns `null` then the item is deleted from the query. (Same
     * behavior as `optimisticallyDeleteItemByKeyIfExists()`.)
     *
     * If the item updates on the server to a new version any optimistic updates will
     * be completely overwritten. So the next update from the server should also
     * reflect the optimistic update we've made here.
     */
    public optimisticallyUpdateItemByKeyIfExists(
        key: DynamoItemKey,
        update: (
            item: RynamoItem<Model> & {readonly extra: Extra | null},
        ) => (RynamoItem<Model> & {readonly extra: Extra | null}) | null,
    ): RynamoIndexQuery<Model, Extra> {
        const itemVisibility = this._itemVisibilityByKey.get(key);
        if (!itemVisibility) return this;

        let itemVisibilityByKey = this._itemVisibilityByKey;
        let itemByCursor = this._itemByCursor;

        if (itemVisibility.isVisible) {
            const iterator = itemByCursor.find(itemVisibility.cursor);
            assert(iterator.node);

            const newItem = update(iterator.node.value);

            if (newItem === null) {
                itemVisibilityByKey = itemVisibilityByKey.set(key, {
                    isVisible: false,
                    version: iterator.node.value.version + 1,
                });
                itemByCursor = iterator.remove();
            }
            // Optimization: Only call `iterator.update()` if the item was actually updated.
            else if (newItem !== iterator.node.value) {
                // `update()` shouldn't change the item version. We'll do that here.
                assert(newItem.version === iterator.node.value.version);

                itemByCursor = iterator.update({
                    ...newItem,
                    version: iterator.node.value.version + 1,
                });
            }
        }

        if (
            itemVisibilityByKey === this._itemVisibilityByKey &&
            itemByCursor === this._itemByCursor
        ) {
            return this;
        }

        return new RynamoIndexQuery({
            indexName: this._indexName,
            partitionKey: this._partitionKey,
            startCursorBound: this._startCursorBound,
            endCursorBound: this._endCursorBound,
            itemByCursor,
            itemVisibilityByKey,
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

function massageRynamoItem<Model, Extra>(
    item: {
        readonly cursor?: DynamoIndexCursor;
    } & RynamoItem<Model>,
    extra: Extra | null,
): RynamoItem<Model> & {
    readonly cursor?: undefined;
    readonly extra: Extra | null;
} {
    const newItem: {[key: string]: any} = {};

    for (const [key, value] of Object.entries(item)) {
        if (key === "cursor") continue;
        newItem[key] = value;
    }

    newItem.extra = extra;

    return newItem as any;
}
