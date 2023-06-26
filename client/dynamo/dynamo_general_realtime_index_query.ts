import createTree, {Tree, Iterator as TreeIterator} from "functional-red-black-tree";
import {
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor, DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {InternalError, OutOfRangeError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {symmetricDiffTree} from "~/shared/helpers/immutable/symmetric_diff_tree.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";

type DynamoGeneralRealtimeIndexQueryLoadedPageInfo =
    | {
          readonly type: "FromStart";
          readonly endCursor: DynamoIndexCursor;
      }
    | {
          readonly type: "FromEnd";
          readonly startCursor: DynamoIndexCursor;
      };

export type DynamoGeneralRealtimeIndexQueryItem<Model> =
    | {
          readonly type: "Loaded";
          readonly cursor: DynamoIndexCursor;
          readonly item: DynamoGeneralRealtimeItem<Model>;
      }
    | {
          readonly type: "LoadingIndicator";
      };

/**
 * An immutable object representing the client state of a query against an
 * index in a DynamoDB realtime table. Handles loading pages fetched from the
 * server with eventual consistency and receiving realtime events out-of-order.
 *
 * Realtime queries should be eventually correct within a few seconds.
 */
export class DynamoGeneralRealtimeIndexQuery<Model> {
    /**
     * The name of the index we are querying. Cursors are only meaningful for a
     * specific index. Can not load results across indexes.
     *
     * Also helps us interpret realtime events. Realtime events include the cursor
     * for every index the item is in. If the item is not in a given index, it
     * won't have a cursor for that index name so we can ignore it.
     */
    private readonly _indexName: string;

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
     * Approximate point in time at which the query is up-to-date. When we connect
     * to realtime we will ask for changes to the query between this time and the
     * current time. This should catch us up on any realtime changes we missed
     * while not connected to realtime.
     *
     * We say this is an approximate time since whenever we load new data or see a
     * new realtime event we will increase this value to the latest time. However,
     * realtime events may arrive out-of-order. So we may not have seen an event
     * before our `readTime`.
     *
     * The server doesn't trust `readTime` and gives us events in a short window
     * earlier than `readTime` to accommodate for race conditions or stale
     * eventually consistent reads.
     */
    private readonly _readTime: Date;

    /**
     * All items we currently know about in our query in order.
     *
     * Items are ordered by cursor so we use a binary tree to maintain that order
     * while allowing for efficient, immutable, updates.
     *
     * May contain items outside of the "loaded page". The loaded page is the slice
     * of the query where we know the client has all items. This is what we return
     * from `getItem()`. We include items outside of the loaded page since we may
     * receive realtime events out of order. See the documentation on
     * `loadedPageInfo` for an example. The loaded page is determined by
     * `loadedPageItemSlice`.
     */
    private readonly _itemByCursor: Tree<
        DynamoIndexCursor,
        DynamoGeneralRealtimeItem<Model> & {
            // Remove `cursor` property before adding to this map. It's not strictly
            // necessary but makes debugging a little cleaner.
            cursor?: undefined;
        }
    >;

    /**
     * A map from item key to item cursor. In case we want to update an item in our
     * list by key and we don't know it's exact position.
     *
     * Also we keep a record of items we've seen but are outside our query's
     * `startCursorBound` and `endCursorBound`. We keep this record in case we
     * receive events out-of-order. Consider an update for an item at version V
     * that updates its name then an update for an item at version V+1 that moves
     * its cursor out of our bounds. If we receive the V+1 realtime event first we
     * hide the item. If we then receive the V realtime event we want to ignore
     * that event and keep the item hidden!
     */
    private readonly _itemVisibilityByKey: ImmutableMap<
        DynamoItemKey,
        | {readonly isVisible: true; readonly cursor: DynamoIndexCursor}
        | {readonly isVisible: false; readonly version: number}
    >;

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
     * 1. We start loading items N through N+10
     * 2. The server loads item N+2 at version V
     * 3. User updates item N+2 to version V+1
     * 4. We receive a realtime update for item N+2 as version V+1
     * 5. We receive the data from the server for items N through N+10 where item
     *    N+2 is version V
     *
     * In this case we don't want to throw away the realtime update we got in step
     * 4 since we will need to apply it after step 5. So our solution is to keep
     * the item around in our list data structure but not render it.
     */
    private readonly _loadedPageInfo: DynamoGeneralRealtimeIndexQueryLoadedPageInfo | null;

    private constructor({
        indexName,
        startCursorBound,
        endCursorBound,
        readTime,
        itemByCursor,
        itemVisibilityByKey,
        loadedPageInfo,
    }: {
        indexName: string;
        startCursorBound: string | null;
        endCursorBound: string | null;
        readTime: Date;
        itemByCursor: Tree<
            DynamoIndexCursor,
            DynamoGeneralRealtimeItem<Model> & {cursor?: undefined}
        >;
        itemVisibilityByKey: ImmutableMap<
            DynamoItemKey,
            | {readonly isVisible: true; readonly cursor: DynamoIndexCursor}
            | {readonly isVisible: false; readonly version: number}
        >;
        loadedPageInfo: DynamoGeneralRealtimeIndexQueryLoadedPageInfo | null;
    }) {
        // Run some data validity assertions to verify assumptions about our data in
        // development and test environments but not in production since these
        // assertions can be expensive.
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
        this._startCursorBound = startCursorBound;
        this._endCursorBound = endCursorBound;
        this._readTime = readTime;
        this._itemByCursor = itemByCursor;
        this._itemVisibilityByKey = itemVisibilityByKey;
        this._loadedPageInfo = loadedPageInfo;
    }

    public getReadTime() {
        return this._readTime;
    }

    /**
     * Initialize our immutable query data type with a query result.
     *
     * Does not currently support initializing data in the middle of the query.
     */
    public static new<Model>(
        result: DynamoGeneralRealtimeIndexQueryResult<Model>,
    ): DynamoGeneralRealtimeIndexQuery<Model> {
        let itemByCursor = createTree<
            DynamoIndexCursor,
            DynamoGeneralRealtimeItem<Model> & {cursor?: undefined}
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
            itemByCursor = itemByCursor.insert(item.cursor, omitObject(item, ["cursor"]));
        }

        let loadedPageInfo: DynamoGeneralRealtimeIndexQueryLoadedPageInfo | null;

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
                // We don't currently support initializing in the middle of a query. This
                // behavior is for when you have a "next page"/"previous page" style UI.
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

                // If we initialized our query with a page starting before a certain cursor
                // then that cursor is our actual end bound.
                //
                // We don't currently support initializing in the middle of a query. This
                // behavior is for when you have a "next page"/"previous page" style UI.
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

        return new DynamoGeneralRealtimeIndexQuery({
            indexName: result.indexName,
            startCursorBound: result.startCursorBound,
            endCursorBound: result.endCursorBound,
            readTime: result.readTime,
            itemByCursor,
            itemVisibilityByKey,
            loadedPageInfo,
        });
    }

    /**
     * Loads more data into the query. Only adds items to the loaded page if the
     * new query result overlaps with data we already have.
     *
     * Throws an error if the data is from a different index.
     */
    public loadMore(
        result: DynamoGeneralRealtimeIndexQueryResult<Model>,
    ): DynamoGeneralRealtimeIndexQuery<Model> {
        return DynamoGeneralRealtimeIndexQuery._loadMore(this, result);
    }

    // Use a static method so we can reassign `this` within the function.
    private static _loadMore<Model>(
        query: DynamoGeneralRealtimeIndexQuery<Model>,
        result: DynamoGeneralRealtimeIndexQueryResult<Model>,
    ): DynamoGeneralRealtimeIndexQuery<Model> {
        if (query._indexName !== result.indexName) {
            throw new InternalError("Tried to load more data from a different index");
        }

        query = query._putItems(
            result.readTime,
            result.items.map(item => ({
                cursor: item.cursor,
                item: omitObject(item, ["cursor"]),
            })),
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
                    const resultStartCursorBound =
                        result.pageInfo.afterCursor !== null &&
                        result.startCursorBound !== null &&
                        result.startCursorBound > result.pageInfo.afterCursor
                            ? result.startCursorBound
                            : result.pageInfo.afterCursor ?? result.startCursorBound;

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
                            : result.pageInfo.beforeCursor ?? result.endCursorBound;

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

        return new DynamoGeneralRealtimeIndexQuery({
            indexName: query._indexName,
            startCursorBound: query._startCursorBound,
            endCursorBound: query._endCursorBound,
            readTime: query._readTime,
            itemByCursor: query._itemByCursor,
            itemVisibilityByKey: query._itemVisibilityByKey,
            loadedPageInfo,
        });
    }

    /**
     * Handles realtime events from the server and incorporates them into our
     * query. Will correctly handle events received out-of-order.
     */
    public handleEventTransaction(
        readTime: Date,
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>,
    ): DynamoGeneralRealtimeIndexQuery<Model> {
        return this._putItems(
            readTime,
            filterMapArray(eventTransaction, event => {
                const cursor = event.cursorByIndexName.get(this._indexName);

                // This item does not have a cursor for this index so it is not present in
                // the index.
                if (cursor === undefined) return null;

                return {
                    cursor,
                    // Items outside of our index will not have the `Model` type. We assume the
                    // server implementation is correct and the types will all work out.
                    item: event.item as DynamoGeneralRealtimeItem<Model>,
                };
            }),
        );
    }

    private _putItems(
        readTime: Date,
        items: Iterable<{
            cursor: DynamoIndexCursor;
            item: DynamoGeneralRealtimeItem<Model> & {cursor?: undefined};
        }>,
    ): DynamoGeneralRealtimeIndexQuery<Model> {
        let itemByCursor = this._itemByCursor;
        let itemVisibilityByKey = this._itemVisibilityByKey;

        for (const {cursor, item} of items) {
            const isCursorVisible =
                (this._startCursorBound === null || this._startCursorBound < cursor) &&
                (this._endCursorBound === null || cursor < this._endCursorBound);

            const oldItemVisibility = itemVisibilityByKey.get(item.key);

            if (oldItemVisibility === undefined) {
                if (isCursorVisible) {
                    itemByCursor = itemByCursor.insert(cursor, item);
                    itemVisibilityByKey = itemVisibilityByKey.set(item.key, {
                        isVisible: true,
                        cursor,
                    });
                } else {
                    itemVisibilityByKey = itemVisibilityByKey.set(item.key, {
                        isVisible: false,
                        version: item.version,
                    });
                }
            } else {
                const oldItemVersion = oldItemVisibility.isVisible
                    ? assertExists(itemByCursor.get(oldItemVisibility.cursor)).version
                    : oldItemVisibility.version;

                // We may receive items out-of-order. Only put the latest the version of the
                // item in our query.
                if (oldItemVersion < item.version) {
                    if (isCursorVisible) {
                        if (oldItemVisibility.isVisible) {
                            if (oldItemVisibility.cursor === cursor) {
                                itemByCursor = itemByCursor.find(cursor).update(item);
                            } else {
                                itemByCursor = itemByCursor.insert(cursor, item);
                                itemByCursor = itemByCursor.remove(oldItemVisibility.cursor);
                                itemVisibilityByKey = itemVisibilityByKey.set(item.key, {
                                    isVisible: true,
                                    cursor,
                                });
                            }
                        } else {
                            itemByCursor = itemByCursor.insert(cursor, item);
                            itemVisibilityByKey = itemVisibilityByKey.set(item.key, {
                                isVisible: true,
                                cursor,
                            });
                        }
                    } else {
                        if (oldItemVisibility.isVisible) {
                            itemByCursor = itemByCursor.remove(oldItemVisibility.cursor);
                            itemVisibilityByKey = itemVisibilityByKey.set(item.key, {
                                isVisible: false,
                                version: item.version,
                            });
                        } else {
                            itemVisibilityByKey = itemVisibilityByKey.set(item.key, {
                                isVisible: false,
                                version: item.version,
                            });
                        }
                    }
                }
            }
        }

        // Optimization: If nothing changed, don't create a new instance.
        if (
            itemByCursor === this._itemByCursor &&
            itemVisibilityByKey === this._itemVisibilityByKey &&
            readTime <= this._readTime
        ) {
            return this;
        }

        return new DynamoGeneralRealtimeIndexQuery({
            indexName: this._indexName,
            startCursorBound: this._startCursorBound,
            endCursorBound: this._endCursorBound,
            readTime: readTime > this._readTime ? readTime : this._readTime,
            itemByCursor,
            itemVisibilityByKey,
            loadedPageInfo: this._loadedPageInfo,
        });
    }

    /**
     * Slice of `itemByCursor` that is in our loaded page. Returns null if all
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

    private _getIteratorIndex(
        iterator: TreeIterator<DynamoIndexCursor, DynamoGeneralRealtimeItem<Model>>,
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
            : this._itemByCursor.length;
    }

    // Optimization: If you are calling `getItem()` in sequence
    // (`getItem(N)`, `getItem(N + 1)`, `getItem(N + 2)`, `getItem(N + 3)`, etc.)
    // then we maintain a mutable iterator so your sequential `getItem()` calls are
    // O(1) instead of O(log(n)).
    private _getItemIterator: {
        index: number;
        iterator: TreeIterator<DynamoIndexCursor, DynamoGeneralRealtimeItem<Model>>;
    } | null = null;

    /**
     * Get the item at the provided index.
     */
    public getItem(index: number): DynamoGeneralRealtimeIndexQueryItem<Model> {
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
     * Get an item by its key if it exists in the query and is loaded.
     */
    public getItemByKeyIfExists(key: DynamoItemKey): {
        readonly index: number;
        readonly cursor: DynamoIndexCursor;
        readonly item: DynamoGeneralRealtimeItem<Model>;
    } | null {
        const itemVisibility = this._itemVisibilityByKey.get(key);
        if (!itemVisibility?.isVisible) return null;

        const iterator = this._itemByCursor.find(itemVisibility.cursor);
        assert(iterator.node);

        const index = this._getIteratorIndex(iterator);
        const loadedPageItemSlice = this._loadedPageItemSlice.get();

        // Make sure the item is in our loaded items range.
        if (
            loadedPageItemSlice &&
            (index < loadedPageItemSlice.startIndex || loadedPageItemSlice.endIndex < index)
        ) {
            return null;
        }

        return {
            index,
            cursor: itemVisibility.cursor,
            item: iterator.node.value,
        };
    }

    /**
     * Get the item after the provided cursor if an item exists.
     */
    public getItemAfterCursorIfExists(
        cursor: DynamoIndexCursor,
    ): DynamoGeneralRealtimeItem<Model> | null {
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
    public getItemBeforeCursorIfExists(
        cursor: DynamoIndexCursor,
    ): DynamoGeneralRealtimeItem<Model> | null {
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
     * Get items that were deleted from the provided `oldQuery` in this query.
     * So any items that were in `oldQuery` but are not in this query.
     */
    public getDeletedItems(oldQuery: DynamoGeneralRealtimeIndexQuery<Model>): Iterable<{
        readonly index: number;
        readonly cursor: DynamoIndexCursor;
        readonly item: DynamoGeneralRealtimeItem<Model>;
    }> {
        const createdItemKeys = new Set<DynamoItemKey>();
        const deletedOldItemByKey = new Map<
            DynamoItemKey,
            {index: number; cursor: DynamoIndexCursor; item: DynamoGeneralRealtimeItem<Model>}
        >();

        for (const change of symmetricDiffTree(oldQuery._itemByCursor, this._itemByCursor)) {
            switch (change.type) {
                // Ignore...
                case "UpdateEntry": {
                    break;
                }
                // We need to look at create changes because if an item is moved then it will
                // be represented as a delete then a create. We only want items that were
                // deleted. Not items that were moved.
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
     * Delete an item in the query if the item exists and is at the specified
     * version.
     *
     * If the item updates on the server to a new version it will appear back in
     * the query. This function is designed to be used as an optimistic delete
     * update. We expect the next update from the server to also delete the item.
     */
    public deleteItemByKeyIfExistsAtVersion(
        key: DynamoItemKey,
        version: number,
    ): DynamoGeneralRealtimeIndexQuery<Model> {
        const itemVisibility = this._itemVisibilityByKey.get(key);
        if (!itemVisibility) return this;

        let itemVisibilityByKey = this._itemVisibilityByKey;
        let itemByCursor = this._itemByCursor;

        if (itemVisibility.isVisible) {
            const iterator = itemByCursor.find(itemVisibility.cursor);
            assert(iterator.node);

            // If the item is at a future version, don't do anything.
            if (iterator.node.value.version > version) {
                return this;
            }

            itemVisibilityByKey = itemVisibilityByKey.set(key, {
                isVisible: false,
                version: version + 1,
            });
            itemByCursor = iterator.remove();
        } else {
            // If the item is at a future version, don't do anything.
            if (itemVisibility.version > version) {
                return this;
            }

            itemVisibilityByKey = itemVisibilityByKey.set(key, {
                isVisible: false,
                version: version + 1,
            });
        }

        return new DynamoGeneralRealtimeIndexQuery({
            indexName: this._indexName,
            startCursorBound: this._startCursorBound,
            endCursorBound: this._endCursorBound,
            readTime: this._readTime,
            itemByCursor,
            itemVisibilityByKey,
            loadedPageInfo: this._loadedPageInfo,
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
