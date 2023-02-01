import createTree, {
    Tree,
    Iterator as TreeIterator,
    Node as TreeNode,
} from "functional-red-black-tree";
import {Key, ReactNode} from "react";
import {OutOfRangeError, UnimplementedError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping";
import {clamp} from "~/shared/helpers/number/clamp";
import {
    OrderKey,
    generateOrderKeyBetween,
    generateOrderKeysBetween,
} from "~/shared/helpers/sort/order_key";

/**
 * How many screens of content to fill on the first virtualized scroll
 * view render?
 *
 * We initially render enough items to fill the user's screen twice (so they
 * have space to scroll). Some of the screen is probably covered so this is
 * more than necessary but we'll never show blank content.
 */
export const initialVirtualizedScrollViewRenderFillScreenCount = 2;

/**
 * Immutable state object for a `<VirtualizedScrollView>` component. It manages the
 * logic for which items should be visible at any given time and how much buffered
 * height we should allocate.
 */
export class VirtualizedScrollViewState {
    private readonly _viewHeight: number;
    private readonly _bufferedItemHeight: number;
    private readonly _entryByOrderKey: Tree<OrderKey, VirtualizedScrollViewStateEntry>;
    private readonly _orderKeyByItemKey: Tree<Key, OrderKey>;
    private readonly _renderedRange: VirtualizedScrollViewStateRenderedRange | null;
    private readonly _itemCountCache: WeakMap<
        TreeNode<OrderKey, VirtualizedScrollViewStateEntry>,
        number
    >;
    private readonly _contentHeightCache: WeakMap<
        TreeNode<OrderKey, VirtualizedScrollViewStateEntry>,
        number
    >;

    private constructor({
        viewHeight,
        bufferedItemHeight,
        entryByOrderKey,
        orderKeyByItemKey,
        renderedRange,
        itemCountCache,
        contentHeightCache,
    }: {
        viewHeight: number;
        bufferedItemHeight: number;
        entryByOrderKey: Tree<OrderKey, VirtualizedScrollViewStateEntry>;
        orderKeyByItemKey: Tree<Key, OrderKey>;
        renderedRange: VirtualizedScrollViewStateRenderedRange | null;
        itemCountCache: WeakMap<TreeNode<OrderKey, VirtualizedScrollViewStateEntry>, number>;
        contentHeightCache: WeakMap<TreeNode<OrderKey, VirtualizedScrollViewStateEntry>, number>;
    }) {
        // Run some expensive validations in development environments.
        if (process.env.NODE_ENV !== "production") {
            const iterator = entryByOrderKey.begin;

            let lastNode: TreeNode<OrderKey, VirtualizedScrollViewStateEntry> | null = null;
            let foundRenderedRangeStartOrderKey = false;
            let foundRenderedRangeEndOrderKey = false;

            while (iterator.node) {
                assert(iterator.node.key !== lastNode?.key, "Must have unique order keys");
                assert(
                    iterator.node.value.type !== "Buffer" || iterator.node.value.itemCount > 0,
                    "Buffer may not have zero items",
                );

                if (
                    renderedRange &&
                    renderedRange.startOrderKey <= iterator.node.key &&
                    iterator.node.key <= renderedRange.endOrderKey
                ) {
                    if (renderedRange.startOrderKey === iterator.node.key)
                        foundRenderedRangeStartOrderKey = true;
                    if (renderedRange.endOrderKey === iterator.node.key)
                        foundRenderedRangeEndOrderKey = true;

                    assert(
                        iterator.node.value.type === "Item",
                        "Entries within rendered range must be items",
                    );
                }

                lastNode = iterator.node;
                iterator.next();
            }

            assert(
                !renderedRange || foundRenderedRangeStartOrderKey,
                "Rendered range start order key not found",
            );
            assert(
                !renderedRange || foundRenderedRangeEndOrderKey,
                "Rendered range end order key not found",
            );
        }

        this._viewHeight = viewHeight;
        this._bufferedItemHeight = bufferedItemHeight;
        this._entryByOrderKey = entryByOrderKey;
        this._orderKeyByItemKey = orderKeyByItemKey;
        this._renderedRange = renderedRange;
        this._itemCountCache = itemCountCache;
        this._contentHeightCache = contentHeightCache;
    }

    /**
     * Initialize our scroll view state by rendering some items starting from
     * the top of the scroll view.
     *
     * Since on initial render we don't know the actual height of our view we use
     * the screen height. This is an overestimation that guarantees we won't have
     * empty space in the view on initial render.
     */
    public static initializeFromTop({
        screenHeight,
        bufferedItemHeight,
        itemCount,
        getItem,
    }: {
        screenHeight: number;
        bufferedItemHeight: number;
        itemCount: number;
        getItem: (index: number) => {key: Key; minHeight: number};
    }): VirtualizedScrollViewState {
        const maxRenderedHeight = screenHeight * initialVirtualizedScrollViewRenderFillScreenCount;
        let renderedHeight = 0;
        const renderedItems: Array<{key: Key; minHeight: number}> = [];

        for (let index = 0; index < itemCount; index++) {
            const item = getItem(index);
            renderedHeight += item.minHeight;
            renderedItems.push(item);

            if (renderedHeight >= maxRenderedHeight) break;
        }

        let entryByOrderKey: Tree<OrderKey, VirtualizedScrollViewStateEntry> = createTree();
        let orderKeyByItemKey: Tree<Key, OrderKey> = createTree();

        const orderKeys = generateOrderKeysBetween(null, null, renderedItems.length + 1);
        const itemKeys = new Set<Key>();

        for (let index = 0; index < renderedItems.length; index++) {
            const item = renderedItems[index]!;
            const orderKey = orderKeys[index]!;

            assert(!itemKeys.has(item.key), "Item keys should be unique");
            itemKeys.add(item.key);

            entryByOrderKey = entryByOrderKey.insert(orderKey, {
                type: "Item",
                key: item.key,
                height: item.minHeight,
            });
            orderKeyByItemKey = orderKeyByItemKey.insert(item.key, orderKey);
        }

        const bufferedItemCount = itemCount - renderedItems.length;
        if (bufferedItemCount > 0) {
            entryByOrderKey = entryByOrderKey.insert(orderKeys[renderedItems.length]!, {
                type: "Buffer",
                itemCount: bufferedItemCount,
            });
        }

        return new VirtualizedScrollViewState({
            viewHeight: screenHeight,
            bufferedItemHeight,
            entryByOrderKey,
            orderKeyByItemKey,
            renderedRange:
                renderedItems.length > 0
                    ? {
                          startOrderKey: orderKeys[0]!,
                          endOrderKey: orderKeys[renderedItems.length - 1]!,
                      }
                    : null,
            itemCountCache: new WeakMap(),
            contentHeightCache: new WeakMap(),
        });
    }

    /**
     * Initialize our scroll view state by rendering some items starting from
     * the bottom of the scroll view.
     *
     * Since on initial render we don't know the actual height of our view we use
     * the screen height. This is an overestimation that guarantees we won't have
     * empty space in the view on initial render.
     */
    public static initializeFromBottom({
        screenHeight,
        bufferedItemHeight,
        itemCount,
        getItem,
    }: {
        screenHeight: number;
        bufferedItemHeight: number;
        itemCount: number;
        getItem: (index: number) => {key: Key; minHeight: number};
    }): VirtualizedScrollViewState {
        const maxRenderedHeight = screenHeight * initialVirtualizedScrollViewRenderFillScreenCount;
        let renderedHeight = 0;
        const renderedItems: Array<{key: Key; minHeight: number}> = [];

        for (let index = itemCount - 1; index >= 0; index--) {
            const item = getItem(index);
            renderedHeight += item.minHeight;
            renderedItems.push(item);

            if (renderedHeight >= maxRenderedHeight) break;
        }

        // We "rendered" items starting at the last one and moving back. Reverse the
        // list for the actual rendered order.
        renderedItems.reverse();

        let entryByOrderKey: Tree<OrderKey, VirtualizedScrollViewStateEntry> = createTree();
        let orderKeyByItemKey: Tree<Key, OrderKey> = createTree();

        const orderKeys = generateOrderKeysBetween(null, null, renderedItems.length + 1);
        const itemKeys = new Set<Key>();

        const bufferedItemCount = itemCount - renderedItems.length;
        if (bufferedItemCount > 0) {
            entryByOrderKey = entryByOrderKey.insert(orderKeys[0]!, {
                type: "Buffer",
                itemCount: bufferedItemCount,
            });
        }

        for (let index = 0; index < renderedItems.length; index++) {
            const item = renderedItems[index]!;
            const orderKey = orderKeys[index + 1]!;

            assert(!itemKeys.has(item.key), "Item keys should be unique");
            itemKeys.add(item.key);

            entryByOrderKey = entryByOrderKey.insert(orderKey, {
                type: "Item",
                key: item.key,
                height: item.minHeight,
            });
            orderKeyByItemKey = orderKeyByItemKey.insert(item.key, orderKey);
        }

        return new VirtualizedScrollViewState({
            viewHeight: screenHeight,
            bufferedItemHeight,
            entryByOrderKey,
            orderKeyByItemKey,
            renderedRange:
                renderedItems.length > 0
                    ? {
                          startOrderKey: orderKeys[1]!,
                          endOrderKey: orderKeys[renderedItems.length]!,
                      }
                    : null,
            itemCountCache: new WeakMap(),
            contentHeightCache: new WeakMap(),
        });
    }

    /**
     * Set the view height.
     *
     * This may shift the virtualization window so you should call
     * `updateRenderedRange()` after.
     */
    public setViewHeight(viewHeight: number): VirtualizedScrollViewState {
        // Optimization: Don't bother updating if the view height
        // doesn't change.
        if (viewHeight === this._viewHeight) return this;

        return new VirtualizedScrollViewState({
            viewHeight,
            bufferedItemHeight: this._bufferedItemHeight,
            entryByOrderKey: this._entryByOrderKey,
            orderKeyByItemKey: this._orderKeyByItemKey,
            renderedRange: this._renderedRange,
            itemCountCache: this._itemCountCache,
            contentHeightCache: this._contentHeightCache,
        });
    }

    /**
     * Set the height of a single buffered item.
     *
     * This may shift the rendered range so you should call
     * `updateRenderedRange()` after.
     */
    public setBufferedItemHeight(bufferedItemHeight: number): VirtualizedScrollViewState {
        // Optimization: Don't bother updating if the buffered item height
        // doesn't change.
        if (bufferedItemHeight === this._bufferedItemHeight) return this;

        return new VirtualizedScrollViewState({
            viewHeight: this._viewHeight,
            bufferedItemHeight,
            entryByOrderKey: this._entryByOrderKey,
            orderKeyByItemKey: this._orderKeyByItemKey,
            renderedRange: this._renderedRange,
            itemCountCache: this._itemCountCache,
            // We need to clear the content height cache when the buffered item height
            // changes since it affects the height of buffer entries.
            contentHeightCache: new WeakMap(),
        });
    }

    /**
     * Set the height of a single item.
     *
     * This may shift the rendered range so you should call
     * `updateRenderedRange()` after.
     */
    public setItemHeight(itemKey: Key, itemHeight: number): VirtualizedScrollViewState {
        const orderKey = this._orderKeyByItemKey.get(itemKey);
        assert(orderKey, "Could not find entry for item key");
        const entryIterator = this._entryByOrderKey.find(orderKey);
        assert(entryIterator.node, "Could not find entry for item key");
        const entry = entryIterator.node.value;
        assert(entry.type === "Item", "Expected an item entry for item key");

        // Optimization: Height did not change so don't update our state.
        if (entry.height === itemHeight) return this;

        return new VirtualizedScrollViewState({
            viewHeight: this._viewHeight,
            bufferedItemHeight: this._bufferedItemHeight,
            entryByOrderKey: entryIterator.update({type: "Item", key: itemKey, height: itemHeight}),
            orderKeyByItemKey: this._orderKeyByItemKey,
            renderedRange: this._renderedRange,
            itemCountCache: this._itemCountCache,
            contentHeightCache: this._contentHeightCache,
        });
    }

    /**
     * Get the number of items in the provided subtree.
     *
     * WARNING: If you want to get the count of all items before the entry you
     * are looking at, do not use `_getSubtreeItemCount(iterator.node.left)` and
     * instead use `_getPreviousItemCount(iterator)`. The former does not count
     * items in parent nodes.
     *
     * This function is cached and takes advantage of the structural sharing in our
     * binary tree. When the tree is updated, some subtrees are left untouched so
     * we maintain the cached value for those subtrees. Running this function on a
     * new tree is O(n) but running this function on an updated tree is O(log(n)).
     */
    private _getSubtreeItemCount(
        node: TreeNode<OrderKey, VirtualizedScrollViewStateEntry> | null,
    ): number {
        if (node === null) return 0;

        const valueItemCount = node.value.type === "Item" ? 1 : node.value.itemCount;

        // Don't spend memory caching nodes with no subtrees.
        if (node.left === null && node.right === null) return valueItemCount;

        let itemCount = this._itemCountCache.get(node);

        if (itemCount === undefined) {
            const leftItemCount = this._getSubtreeItemCount(node.left);
            const rightItemCount = this._getSubtreeItemCount(node.right);

            itemCount = leftItemCount + valueItemCount + rightItemCount;
            this._itemCountCache.set(node, itemCount);
        }

        return itemCount;
    }

    /**
     * Get the item count of all entries before the node the iterator is
     * looking at.
     */
    private _getPreviousItemCount(
        iterator: TreeIterator<OrderKey, VirtualizedScrollViewStateEntry>,
    ): number {
        if (!iterator.node) return 0;
        let itemCount = this._getSubtreeItemCount(iterator.node.left);
        const beforeOrderKey = iterator.node.key;

        for (let i = iterator._stack.length - 2; i >= 0; i--) {
            const parentNode = iterator._stack[i]!;

            if (parentNode.key < beforeOrderKey) {
                itemCount += parentNode.value.type === "Item" ? 1 : parentNode.value.itemCount;
                itemCount += this._getSubtreeItemCount(parentNode.left);
            }
        }

        return itemCount;
    }

    /**
     * The total number of items in our scroll view.
     */
    public getItemCount(): number {
        return this._getSubtreeItemCount(this._entryByOrderKey.root);
    }

    /**
     * Get the height, in pixels, of the provided subtree.
     *
     * WARNING: If you want to get the count of all height before the entry you
     * are looking at, do not use `_getSubtreeContentHeight(iterator.node.left)`
     * and instead use `_getPreviousContentHeight(iterator)`. The former does not
     * count height in parent nodes.
     *
     * This function is cached and takes advantage of the structural sharing in our
     * binary tree. When the tree is updated, some subtrees are left untouched so
     * we maintain the cached value for those subtrees. Running this function on a
     * new tree is O(n) but running this function on an updated tree is O(log(n)).
     */
    private _getSubtreeContentHeight(
        node: TreeNode<OrderKey, VirtualizedScrollViewStateEntry> | null,
    ): number {
        if (node === null) return 0;

        const valueContentHeight =
            node.value.type === "Item"
                ? node.value.height
                : node.value.itemCount * this._bufferedItemHeight;

        // Don't spend memory caching nodes with no subtrees.
        if (node.left === null && node.right === null) return valueContentHeight;

        let contentHeight = this._contentHeightCache.get(node);

        if (contentHeight === undefined) {
            const leftContentHeight = this._getSubtreeContentHeight(node.left);
            const rightContentHeight = this._getSubtreeContentHeight(node.right);

            contentHeight = leftContentHeight + valueContentHeight + rightContentHeight;
            this._contentHeightCache.set(node, contentHeight);
        }

        return contentHeight;
    }

    /**
     * Get the content height of all entries before the node the iterator is
     * looking at.
     */
    private _getPreviousContentHeight(
        iterator: TreeIterator<OrderKey, VirtualizedScrollViewStateEntry>,
    ): number {
        if (!iterator.node) return 0;
        let contentHeight = this._getSubtreeContentHeight(iterator.node.left);
        const beforeOrderKey = iterator.node.key;

        for (let i = iterator._stack.length - 2; i >= 0; i--) {
            const parentNode = iterator._stack[i]!;

            if (parentNode.key < beforeOrderKey) {
                contentHeight +=
                    parentNode.value.type === "Item"
                        ? parentNode.value.height
                        : parentNode.value.itemCount * this._bufferedItemHeight;

                contentHeight += this._getSubtreeContentHeight(parentNode.left);
            }
        }

        return contentHeight;
    }

    /**
     * The total height of our scroll view.
     */
    public getContentHeight(): number {
        return this._getSubtreeContentHeight(this._entryByOrderKey.root);
    }

    /**
     * Updates the range of items our scroll view is rendering.
     *
     * There are two ranges this function compares:
     *
     * 1. Virtualization window: This is the range of our view we want to fill with
     *    content. It includes the window of content the user is looking at and a
     *    little buffer in either direction so if the user scrolls quickly they
     *    don't see empty space.
     *
     * 2. Rendered range: This is the range of the view we have filled with
     *    rendered content. We should always have more content rendered than the
     *    virtualization window to guarantee we are always covering the
     *    virtualization window.
     *
     * As the user scrolls the virtualization window moves. As items change height
     * or items are added/removed the rendered range shifts around. We want to make
     * sure the rendered range always covers the virtualization window, so whenever
     * something happens that could cause the rendered range to not cover the
     * virtualization window you should call this function to rectify that.
     *
     * If our rendered range already completely covers the virtualization window
     * then this function returns the state object as-is.
     */
    public updateRenderedRange(options: {
        scrollOffset: number;
        itemCount: number;
        getItem: (index: number) => {key: Key; minHeight: number};
    }): VirtualizedScrollViewState {
        return VirtualizedScrollViewState._updateRenderedRange(this, options);
    }

    // Implemented with a static function so we can reassign to the `state`
    // variable. We can't reassign to `this` in an instance method.
    private static _updateRenderedRange(
        state: VirtualizedScrollViewState,
        {
            scrollOffset,
            itemCount,
            getItem,
        }: {
            scrollOffset: number;
            itemCount: number;
            getItem: (index: number) => {key: Key; minHeight: number};
        },
    ): VirtualizedScrollViewState {
        // Validation to make sure that every index has a unique key. In future
        // renders items may move around so two indexes may have the same key at
        // different points in time but at a given point in time each index should
        // have its own key.
        {
            const originalGetItem = getItem;
            const indexByKey = new Map<Key, number>();
            getItem = index => {
                const item = originalGetItem(index);

                const expectedIndex = indexByKey.get(item.key);
                if (expectedIndex === undefined) indexByKey.set(item.key, index);
                assert(
                    expectedIndex === undefined || expectedIndex === index,
                    "Must have a unique item key for every index",
                );

                return item;
            };
        }

        // You should call `render()` before this function when the item count changes.
        // `render()` will adjust the item count.
        assert(itemCount === state.getItemCount(), "Item count mismatch");

        // There is no rendered range when there are no items.
        if (itemCount === 0) return state;

        const contentHeight = state.getContentHeight();

        const minScrollStartOffset = 0;
        const maxScrollStartOffset = Math.max(0, contentHeight - state._viewHeight);

        const minScrollEndOffset = Math.min(state._viewHeight, contentHeight);
        const maxScrollEndOffset = contentHeight;

        const scrollStartOffset = clamp(minScrollStartOffset, scrollOffset, maxScrollStartOffset);
        const scrollEndOffset = clamp(
            minScrollEndOffset,
            scrollStartOffset + state._viewHeight,
            maxScrollEndOffset,
        );

        // The virtualized window is the range we expect to be filled with content. It
        // is the scroll window plus half a view in either direction so that a user
        // scrolling quickly will see more content.
        const virtualizedWindowStartOffset = scrollStartOffset - state._viewHeight * 0.5;
        const virtualizedWindowEndOffset = scrollEndOffset + state._viewHeight * 0.5;
        const clampedVirtualizedWindowStartOffset = clamp(
            minScrollStartOffset,
            virtualizedWindowStartOffset,
            maxScrollStartOffset,
        );
        const clampedVirtualizedWindowEndOffset = clamp(
            minScrollEndOffset,
            virtualizedWindowEndOffset,
            maxScrollEndOffset,
        );

        // Expands an existing rendered range that intersects with our virtualized
        // window to cover our virtualized window.
        const expandRenderedRange = (
            oldRenderedRangeStartOrderKey: OrderKey,
            oldRenderedRangeStartIndex: number,
            oldRenderedRangeStartOffset: number,
            oldRenderedRangeEndOrderKey: OrderKey,
            oldRenderedRangeEndIndex: number,
            oldRenderedRangeEndOffset: number,
        ) => {
            let newRenderedRangeStartOrderKey = oldRenderedRangeStartOrderKey;
            let newRenderedRangeStartIndex = oldRenderedRangeStartIndex;
            let newRenderedRangeStartOffset = oldRenderedRangeStartOffset;
            let newRenderedRangeEndOrderKey = oldRenderedRangeEndOrderKey;
            let newRenderedRangeEndIndex = oldRenderedRangeEndIndex;
            let newRenderedRangeEndOffset = oldRenderedRangeEndOffset;

            // Finds the last possible item in our list that covers the top of the
            // virtualized window through an iterative algorithm.
            //
            // 1. If our current start item is below the virtualized window top then we
            //    iteratively search previous items for the first item above the
            //    virtualized window top.
            //
            // 2. If our current start item is above the virtualized window top then we
            //    iteratively search the next items for the last possible item above the
            //    virtualized window top. This is optional. We do this to minimize the
            //    number of items we need to render. Our current start item would also
            //    cover the virtualized window.
            //
            // Case 1 is the first branch of the `if` and case 2 is the second branch of
            // the `if`.
            if (newRenderedRangeStartOffset > virtualizedWindowStartOffset) {
                const iterator = state._entryByOrderKey.find(oldRenderedRangeStartOrderKey);
                assert(iterator.node, "Could not find rendered range start order key");
                iterator.prev();

                while (
                    iterator.node &&
                    newRenderedRangeStartOffset > virtualizedWindowStartOffset
                ) {
                    const node = iterator.node;
                    iterator.prev();

                    newRenderedRangeStartIndex -= 1;
                    const item = getItem(newRenderedRangeStartIndex);

                    // If the previous item in the list is the same one we're expecting then great!
                    // No updates to the list necessary.
                    if (node.value.type === "Item" && node.value.key === item.key) {
                        newRenderedRangeStartOffset -= node.value.height;
                        newRenderedRangeStartOrderKey = node.key;
                    }
                    // If the previous item in the list is a different one then we want to replace
                    // that item with our new one. If the new item existed somewhere else in the
                    // list it will be replaced with a buffer.
                    else if (node.value.type === "Item") {
                        state = VirtualizedScrollViewState._setEntry(
                            state,
                            node.key,
                            {
                                type: "Item",
                                key: item.key,
                                height: item.minHeight,
                            },
                            getItem,
                        );
                        newRenderedRangeStartOffset -= item.minHeight;
                        newRenderedRangeStartOrderKey = node.key;
                    }
                    // If the previous item in the list is a buffer then we replace as many buffer
                    // items as we can with actual rendered items.
                    else {
                        let newBufferItemCount = node.value.itemCount;

                        newBufferItemCount -= 1;

                        const newEntryOrderKey = generateOrderKeyBetween(
                            node.key,
                            newRenderedRangeStartOrderKey,
                        );
                        state = VirtualizedScrollViewState._setEntry(
                            state,
                            newEntryOrderKey,
                            {
                                type: "Item",
                                key: item.key,
                                height: item.minHeight,
                            },
                            getItem,
                        );
                        newRenderedRangeStartOffset -= item.minHeight;
                        newRenderedRangeStartOrderKey = newEntryOrderKey;

                        while (
                            newBufferItemCount > 0 &&
                            newRenderedRangeStartOffset > virtualizedWindowStartOffset
                        ) {
                            newRenderedRangeStartIndex -= 1;
                            const item = getItem(newRenderedRangeStartIndex);

                            newBufferItemCount -= 1;

                            const newEntryOrderKey = generateOrderKeyBetween(
                                node.key,
                                newRenderedRangeStartOrderKey,
                            );
                            state = VirtualizedScrollViewState._setEntry(
                                state,
                                newEntryOrderKey,
                                {
                                    type: "Item",
                                    key: item.key,
                                    height: item.minHeight,
                                },
                                getItem,
                            );
                            newRenderedRangeStartOffset -= item.minHeight;
                            newRenderedRangeStartOrderKey = newEntryOrderKey;
                        }

                        if (newBufferItemCount > 0) {
                            state = VirtualizedScrollViewState._setEntry(
                                state,
                                node.key,
                                {
                                    type: "Buffer",
                                    itemCount: newBufferItemCount,
                                },
                                getItem,
                            );
                        } else {
                            state = VirtualizedScrollViewState._deleteEntry(state, node.key);
                        }
                    }
                }
            } else {
                const iterator = state._entryByOrderKey.find(oldRenderedRangeStartOrderKey);
                assert(iterator.node, "Could not find rendered range start order key");

                while (
                    iterator.node &&
                    newRenderedRangeStartOrderKey < oldRenderedRangeEndOrderKey
                ) {
                    const node = iterator.node;
                    iterator.next();
                    const nextNode = iterator.valid ? iterator.node : null;
                    if (!nextNode) break;

                    assert(
                        node.value.type === "Item",
                        "All entries in our rendered range should be items",
                    );

                    // Stop moving forwards if it would cause us to not cover our
                    // virtualized window.
                    if (
                        newRenderedRangeStartOffset + node.value.height >
                        virtualizedWindowStartOffset
                    ) {
                        break;
                    }

                    newRenderedRangeStartIndex += 1;
                    newRenderedRangeStartOffset += node.value.height;
                    newRenderedRangeStartOrderKey = nextNode.key;
                }
            }

            // Finds the first possible item in our list that covers the bottom of the
            // virtualized window through an iterative algorithm.
            //
            // 1. If our current end item is above the virtualized window bottom then we
            //    iteratively search the next items for the first item below the
            //    virtualized window bottom.
            //
            // 2. If our current end item is below the virtualized window bottom then we
            //    iteratively search previous items for the last possible item below the
            //    virtualized window bottom. This is optional. We do this to minimize the
            //    number of items we need to render. Our current end item would also cover
            //    the virtualized window.
            //
            // Case 1 is the first branch of the `if` and case 2 is the second branch of
            // the `if`.
            if (newRenderedRangeEndOffset < virtualizedWindowEndOffset) {
                const iterator = state._entryByOrderKey.find(oldRenderedRangeEndOrderKey);
                assert(iterator.node, "Could not find rendered range end order key");
                iterator.next();

                while (iterator.node && newRenderedRangeEndOffset < virtualizedWindowEndOffset) {
                    const node = iterator.node;
                    iterator.next();

                    newRenderedRangeEndIndex += 1;
                    const item = getItem(newRenderedRangeEndIndex);

                    // If the next item in the list is the same one we're expecting then great! No
                    // updates to the list necessary.
                    if (node.value.type === "Item" && node.value.key === item.key) {
                        newRenderedRangeEndOffset += node.value.height;
                        newRenderedRangeEndOrderKey = node.key;
                    }
                    // If the next item in the list is a different one then we want to replace that
                    // item with our new one. If the new item existed somewhere else in the list it
                    // will be replaced with a buffer.
                    else if (node.value.type === "Item") {
                        state = VirtualizedScrollViewState._setEntry(
                            state,
                            node.key,
                            {
                                type: "Item",
                                key: item.key,
                                height: item.minHeight,
                            },
                            getItem,
                        );
                        newRenderedRangeEndOffset += item.minHeight;
                        newRenderedRangeEndOrderKey = node.key;
                    }
                    // If the next item in the list is a buffer then we replace as many buffer items
                    // as we can with actual rendered items.
                    else {
                        let newBufferItemCount = node.value.itemCount;

                        newBufferItemCount -= 1;

                        const newEntryOrderKey = generateOrderKeyBetween(
                            newRenderedRangeEndOrderKey,
                            node.key,
                        );
                        state = VirtualizedScrollViewState._setEntry(
                            state,
                            newEntryOrderKey,
                            {
                                type: "Item",
                                key: item.key,
                                height: item.minHeight,
                            },
                            getItem,
                        );
                        newRenderedRangeEndOffset += item.minHeight;
                        newRenderedRangeEndOrderKey = newEntryOrderKey;

                        while (
                            newBufferItemCount > 0 &&
                            newRenderedRangeEndOffset < virtualizedWindowEndOffset
                        ) {
                            newRenderedRangeEndIndex += 1;
                            const item = getItem(newRenderedRangeEndIndex);

                            newBufferItemCount -= 1;

                            const newEntryOrderKey = generateOrderKeyBetween(
                                newRenderedRangeEndOrderKey,
                                node.key,
                            );
                            state = VirtualizedScrollViewState._setEntry(
                                state,
                                newEntryOrderKey,
                                {
                                    type: "Item",
                                    key: item.key,
                                    height: item.minHeight,
                                },
                                getItem,
                            );
                            newRenderedRangeEndOffset += item.minHeight;
                            newRenderedRangeEndOrderKey = newEntryOrderKey;
                        }

                        if (newBufferItemCount > 0) {
                            state = VirtualizedScrollViewState._setEntry(
                                state,
                                node.key,
                                {
                                    type: "Buffer",
                                    itemCount: newBufferItemCount,
                                },
                                getItem,
                            );
                        } else {
                            state = VirtualizedScrollViewState._deleteEntry(state, node.key);
                        }
                    }
                }
            } else {
                const iterator = state._entryByOrderKey.find(oldRenderedRangeEndOrderKey);
                assert(iterator.node, "Could not find rendered range end order key");

                while (
                    iterator.node &&
                    newRenderedRangeEndOrderKey > oldRenderedRangeStartOrderKey
                ) {
                    const node = iterator.node;
                    iterator.prev();
                    const previousNode = iterator.valid ? iterator.node : null;
                    if (!previousNode) break;

                    assert(
                        node.value.type === "Item",
                        "All entries in our rendered range should be items",
                    );

                    // Stop moving back if it would cause us to not cover our
                    // virtualized window.
                    if (newRenderedRangeEndOffset - node.value.height < virtualizedWindowEndOffset)
                        break;

                    newRenderedRangeEndIndex -= 1;
                    newRenderedRangeEndOffset -= node.value.height;
                    newRenderedRangeEndOrderKey = previousNode.key;
                }
            }

            return new VirtualizedScrollViewState({
                viewHeight: state._viewHeight,
                bufferedItemHeight: state._bufferedItemHeight,
                entryByOrderKey: state._entryByOrderKey,
                orderKeyByItemKey: state._orderKeyByItemKey,
                renderedRange: {
                    startOrderKey: newRenderedRangeStartOrderKey,
                    endOrderKey: newRenderedRangeEndOrderKey,
                },
                itemCountCache: state._itemCountCache,
                contentHeightCache: state._contentHeightCache,
            });
        };

        // This function handles when the user is scrolled at a completely unknown
        // position. So we can't incrementally extend the rendered range we already
        // have, we need to create a completely new rendered range.
        const resetRenderedRange = (): VirtualizedScrollViewState => {
            state = new VirtualizedScrollViewState({
                viewHeight: state._viewHeight,
                bufferedItemHeight: state._bufferedItemHeight,
                entryByOrderKey: state._entryByOrderKey,
                orderKeyByItemKey: state._orderKeyByItemKey,
                renderedRange: null,
                itemCountCache: state._itemCountCache,
                contentHeightCache: state._contentHeightCache,
            });

            // Perform a binary search for the node which contains the provided offset.
            const search = (
                offset: number,
                node: TreeNode<OrderKey, VirtualizedScrollViewStateEntry> | null,
                stack: Array<TreeNode<OrderKey, VirtualizedScrollViewStateEntry>>,
            ): {
                node: TreeNode<OrderKey, VirtualizedScrollViewStateEntry>;
                nodeOffset: number;
            } | null => {
                if (!node) return null;
                stack.push(node);

                const valueContentHeight =
                    node.value.type === "Item"
                        ? node.value.height
                        : node.value.itemCount * state._bufferedItemHeight;

                const leftContentHeight = state._getSubtreeContentHeight(node.left);

                // If the offset is in our node then hooray! Return this node and the offset.
                //
                // Otherwise the offset is either in the left subtree or right subtree of this
                // node. Find the appropriate subtree and recurse.
                if (
                    leftContentHeight <= offset &&
                    offset < leftContentHeight + valueContentHeight
                ) {
                    return {node, nodeOffset: offset};
                } else if (offset < leftContentHeight) {
                    return search(offset, node.left, stack);
                } else {
                    assert(leftContentHeight + valueContentHeight <= offset);
                    return search(
                        offset - (leftContentHeight + valueContentHeight),
                        node.right,
                        stack,
                    );
                }
            };

            const iteratorStack: Array<TreeNode<OrderKey, VirtualizedScrollViewStateEntry>> = [];
            const searchResult = search(
                clampedVirtualizedWindowStartOffset,
                state._entryByOrderKey.root,
                iteratorStack,
            );

            // If we can't find a node at the offset we are searching for, return an empty
            // rendered range.
            if (!searchResult) return state;

            // HACK(calebmer): Hackishly get the constructor for a
            // `functional-red-black-tree` iterator and construct it since there's not an
            // official API. This happens to be a tiny bit more efficient than calling
            // `tree.find()` with the node returned from `search()` given we already know
            // the node stack.
            const iterator: TreeIterator<OrderKey, VirtualizedScrollViewStateEntry> = new (
                state._entryByOrderKey.begin as any
            ).constructor(state._entryByOrderKey, iteratorStack);

            // The stack should be non-empty if `searchResult` is not null.
            assert(iterator.node);

            const node = iterator.node;

            // If we land in a measured item, then expand our rendered range from there.
            if (node.value.type === "Item") {
                const index = state._getPreviousItemCount(iterator);
                const offset = state._getPreviousContentHeight(iterator);

                return expandRenderedRange(
                    node.key,
                    index,
                    offset,
                    node.key,
                    index,
                    offset + node.value.height,
                );
            }

            // Our start offset is inside of a buffer. Determine where exactly we are in
            // the buffer, split the buffer in two by adding a single item, and expand the
            // rendered range from there to fill the virtualization window.
            assert(node.value.type === "Buffer");

            const bufferedItemIndex = Math.floor(
                node.value.itemCount *
                    (searchResult.nodeOffset / (node.value.itemCount * state._bufferedItemHeight)),
            );

            const newBufferedItemCountBefore = bufferedItemIndex;
            const newBufferedItemCountAfter = node.value.itemCount - bufferedItemIndex - 1;

            const index = state._getPreviousItemCount(iterator) + bufferedItemIndex;
            const offset =
                state._getPreviousContentHeight(iterator) +
                newBufferedItemCountBefore * state._bufferedItemHeight;

            const item = getItem(index);

            let previousNode: TreeNode<OrderKey, VirtualizedScrollViewStateEntry> | null = null;
            let nextNode: TreeNode<OrderKey, VirtualizedScrollViewStateEntry> | null = null;

            if (iterator.hasPrev) {
                iterator.prev();
                previousNode = iterator.node;
                iterator.next();
            }

            if (iterator.hasNext) {
                iterator.next();
                nextNode = iterator.node;
            }

            state = VirtualizedScrollViewState._setEntry(
                state,
                node.key,
                {
                    type: "Item",
                    key: item.key,
                    height: item.minHeight,
                },
                getItem,
            );

            if (newBufferedItemCountBefore > 0) {
                state = VirtualizedScrollViewState._setEntry(
                    state,
                    generateOrderKeyBetween(previousNode?.key ?? null, node.key),
                    {
                        type: "Buffer",
                        itemCount: newBufferedItemCountBefore,
                    },
                    getItem,
                );
            }

            if (newBufferedItemCountAfter > 0) {
                state = VirtualizedScrollViewState._setEntry(
                    state,
                    generateOrderKeyBetween(node.key, nextNode?.key ?? null),
                    {
                        type: "Buffer",
                        itemCount: newBufferedItemCountAfter,
                    },
                    getItem,
                );
            }

            return expandRenderedRange(
                node.key,
                index,
                offset,
                node.key,
                index,
                offset + item.minHeight,
            );
        };

        if (!state._renderedRange) return resetRenderedRange();

        // The rendered range is the range we are currently filling with content. We
        // update the rendered range if we detect our rendered range does not fully
        // cover the virtualized window.
        const renderedRangeIterator = state._entryByOrderKey.find(
            state._renderedRange.startOrderKey,
        );
        assert(renderedRangeIterator.node, "Could not find rendered range start order key");
        const renderedRangeStartNode = renderedRangeIterator.node;
        assert(
            renderedRangeStartNode.value.type === "Item",
            "Rendered range should only contain item entries",
        );
        const renderedRangeStartIndex = state._getPreviousItemCount(renderedRangeIterator);
        const renderedRangeStartOffset = state._getPreviousContentHeight(renderedRangeIterator);

        let renderedRangeEndNode: TreeNode<OrderKey, VirtualizedScrollViewStateEntry> | undefined;
        let renderedRangeItemCount = 0;
        let renderedRangeEndOffset = renderedRangeStartOffset;

        // Iterate through our rendered range to find the end of the range.
        while (renderedRangeIterator.node) {
            const renderedRangeNode = renderedRangeIterator.node;
            assert(
                renderedRangeNode.value.type === "Item",
                "Rendered range should only contain item entries",
            );

            renderedRangeItemCount += 1;
            renderedRangeEndOffset += renderedRangeNode.value.height;

            // Stop iteration when we've either found the end order key or we've passed it.
            if (renderedRangeNode.key >= state._renderedRange.endOrderKey) {
                if (renderedRangeNode.key === state._renderedRange.endOrderKey)
                    renderedRangeEndNode = renderedRangeNode;
                break;
            }

            renderedRangeIterator.next();
        }

        assert(renderedRangeEndNode, "Could not find rendered range end order key");

        // Is our rendered range fully covering the virtualized window?
        const isRenderedRangeCoveringVirtualizedWindow =
            renderedRangeStartOffset <= clampedVirtualizedWindowStartOffset &&
            renderedRangeEndOffset >= clampedVirtualizedWindowEndOffset;

        // Is our rendered range partially intersecting with the virtualized window?
        //
        // If this is true but `isRenderedRangeCoveringVirtualizedWindow` is false then
        // we're covering some of the virtualized window but not all of it. We need to
        // update our rendered range to cover the entire virtualized window.
        const isRenderedRangeIntersectingVirtualizedWindow = areRangesOverlapping(
            renderedRangeStartOffset,
            renderedRangeEndOffset,
            clampedVirtualizedWindowStartOffset,
            clampedVirtualizedWindowEndOffset,
        );

        // Our rendered range covers everything we want to render. Don't bother
        // updating it.
        if (isRenderedRangeCoveringVirtualizedWindow) return state;

        if (!isRenderedRangeIntersectingVirtualizedWindow) {
            return resetRenderedRange();
        } else {
            return expandRenderedRange(
                state._renderedRange.startOrderKey,
                renderedRangeStartIndex,
                renderedRangeStartOffset,
                state._renderedRange.endOrderKey,
                renderedRangeStartIndex + renderedRangeItemCount - 1,
                renderedRangeEndOffset,
            );
        }
    }

    /**
     * React render function. Renders the items specified in our rendered range. If
     * the item props changed (`itemCount` or the item at the index) then the state
     * may do simple updates to accommodate these changes for the React render but
     * you need to call `updateRenderedRange()` to get correct content rendered.
     */
    public render(options: {
        itemCount: number;
        getItem: (index: number) => {
            key: Key;
            minHeight: number;
            renderAdditionalItemIndexes?: ReadonlyArray<number>;
            render: (props: {
                offset: number;
                height: number;
                getIndexPosition: (index: number) => {offset: number; height: number};
            }) => ReactNode;
        };
    }): {
        state: VirtualizedScrollViewState;
        children: ReactNode;
        contentHeight: number;
        bufferedHeightBeforeChildren: number;
        renderedRange: {startIndex: number; endIndex: number} | null;
    } {
        return VirtualizedScrollViewState._render(this, options);
    }

    // Implemented with a static function so we can reassign to the `state`
    // variable. We can't reassign to `this` in an instance method.
    private static _render(
        state: VirtualizedScrollViewState,
        {
            itemCount,
            getItem,
        }: {
            itemCount: number;
            getItem: (index: number) => {
                key: Key;
                minHeight: number;
                renderAdditionalItemIndexes?: ReadonlyArray<number>;
                render: (props: {
                    offset: number;
                    height: number;
                    getIndexPosition: (index: number) => {offset: number; height: number};
                }) => ReactNode;
            };
        },
    ): {
        state: VirtualizedScrollViewState;
        children: ReactNode;
        contentHeight: number;
        bufferedHeightBeforeChildren: number;
        renderedRange: {startIndex: number; endIndex: number} | null;
    } {
        // Validation to make sure that every index has a unique key. In future
        // renders items may move around so two indexes may have the same key at
        // different points in time but at a given point in time each index should
        // have its own key.
        {
            const originalGetItem = getItem;
            const indexByKey = new Map<Key, number>();
            getItem = index => {
                const item = originalGetItem(index);

                const expectedIndex = indexByKey.get(item.key);
                if (expectedIndex === undefined) {
                    indexByKey.set(item.key, index);
                } else {
                    assert(expectedIndex === index, "Must have a unique item key for every index");
                }

                return item;
            };
        }

        const itemCountDifference = itemCount - state.getItemCount();

        // If there is a different number of items then what is in our state and what
        // we were passed as props, reconcile that difference by adding or removing
        // items to the end.
        //
        // - If there are more items, add buffer to the end.
        // - If there are fewer items, delete items from the end. This may also update
        //   our rendered range. If all items in the rendered range our delete it is
        //   set to null.
        //
        // NOTE(calebmer): We may want to consider letting the developer configure
        // whether we add/remove items from the beginning or end of the virtualized
        // list? Does it make meaningful difference?
        if (itemCountDifference > 0) {
            const orderKey = generateOrderKeyBetween(
                state._entryByOrderKey.end.node?.key ?? null,
                null,
            );
            state = VirtualizedScrollViewState._setEntry(
                state,
                orderKey,
                {
                    type: "Buffer",
                    itemCount: itemCountDifference,
                },
                getItem,
            );
        } else if (itemCountDifference < 0) {
            let removeItemCount = itemCountDifference * -1;
            let newRenderedRange = state._renderedRange;

            const iterator = state._entryByOrderKey.end;
            while (iterator.node && removeItemCount > 0) {
                const node = iterator.node;
                iterator.prev();
                const previousNode = iterator.valid ? iterator.node : null;

                if (node.value.type === "Item") {
                    // If we are deleting an item in the rendered range then we need to update the
                    // rendered range.
                    if (newRenderedRange) {
                        if (newRenderedRange.startOrderKey >= node.key) {
                            newRenderedRange = null;
                        } else if (newRenderedRange.endOrderKey >= node.key) {
                            newRenderedRange = {
                                startOrderKey: newRenderedRange.startOrderKey,
                                endOrderKey: previousNode?.key ?? newRenderedRange.startOrderKey,
                            };
                        }
                    }

                    state = VirtualizedScrollViewState._deleteEntry(state, node.key, {
                        newRenderedRange,
                    });
                    removeItemCount -= 1;
                } else {
                    if (node.value.itemCount <= removeItemCount) {
                        state = VirtualizedScrollViewState._deleteEntry(state, node.key);
                        removeItemCount -= node.value.itemCount;
                    } else {
                        state = VirtualizedScrollViewState._setEntry(
                            state,
                            node.key,
                            {
                                type: "Buffer",
                                itemCount: node.value.itemCount - removeItemCount,
                            },
                            getItem,
                        );
                        removeItemCount = 0;
                    }
                }
            }
        }

        // If there is no rendered range, our virtualized list renders nothing.
        if (!state._renderedRange) {
            return {
                state,
                children: null,
                contentHeight: state.getContentHeight(),
                bufferedHeightBeforeChildren: 0,
                renderedRange: null,
            };
        }

        const children: Array<ReactNode> = [];

        const iterator = state._entryByOrderKey.find(state._renderedRange.startOrderKey);
        assert(iterator.node, "Could not find rendered range start order key");
        const bufferedHeightBeforeChildren = state._getPreviousContentHeight(iterator);
        const startIndex = state._getPreviousItemCount(iterator);
        let endIndex = startIndex;
        let offset = bufferedHeightBeforeChildren;
        const renderAdditionalItemIndexes = new Set<number>();

        const getIndexPosition = (index: number) => {
            const {iterator, nodeIndex} = state._getNodeAtIndex(index);
            const node = assertExists(iterator.node);
            if (node.value.type === "Item") {
                assert(nodeIndex === 0);
                return {
                    offset: state._getPreviousContentHeight(iterator),
                    height: node.value.height,
                };
            } else {
                return {
                    offset:
                        state._getPreviousContentHeight(iterator) +
                        nodeIndex * state._bufferedItemHeight,
                    height: state._bufferedItemHeight,
                };
            }
        };

        while (iterator.node && iterator.node.key <= state._renderedRange!.endOrderKey) {
            const node = iterator.node;
            assert(node.value.type === "Item", "Entries within rendered range must be items");
            iterator.next();

            const index = endIndex;
            const item = getItem(index);
            const itemHeight = node.value.key === item.key ? node.value.height : item.minHeight;

            const renderedItem = item.render({
                offset,
                height: itemHeight,
                getIndexPosition: searchIndex => {
                    // NOTE(calebmer): We do not allow this because we are not done laying out items
                    // after this one. We could implement this by laying out all items first then
                    // calling `render()`.
                    if (searchIndex > index)
                        throw new UnimplementedError(
                            "Can not get the offset for an index after the item index",
                        );

                    return getIndexPosition(searchIndex);
                },
            });

            if (item.renderAdditionalItemIndexes)
                for (const index of item.renderAdditionalItemIndexes)
                    renderAdditionalItemIndexes.add(index);

            // If the item key changed from what we have in state then we need to set a new
            // entry in our state with a new key and new height.
            if (node.value.key !== item.key) {
                state = VirtualizedScrollViewState._setEntry(
                    state,
                    node.key,
                    {
                        type: "Item",
                        key: item.key,
                        height: item.minHeight,
                    },
                    getItem,
                );
            }

            children.push(renderedItem);
            endIndex += 1;
            offset += itemHeight;
        }

        if (renderAdditionalItemIndexes.size > 0) {
            for (const index of Array.from(renderAdditionalItemIndexes).sort((a, b) => a - b)) {
                // If the index was in our rendered range, we don't need to render it again.
                if (startIndex <= index && index < endIndex) continue;

                // NOTE(calebmer): Rendering items above the rendered range would change would
                // change the offsets of the children we already rendered. It also means we
                // can't rely on one `bufferedHeightBeforeChildren` to push down relatively
                // positioned children and would need multiple spacer elements.
                //
                // We're not solving these problems for now since coincidentally we only need
                // this feature for additional items after the rendered range. But there's no
                // reason we couldn't support this in theory.
                if (index < startIndex) {
                    throw new UnimplementedError(
                        "Rendering additional items before the rendered range is currently unsupported",
                    );
                }

                const item = getItem(index);
                const {iterator, nodeIndex} = state._getNodeAtIndex(index);
                const node = assertExists(iterator.node);
                const nodeOffset = state._getPreviousContentHeight(iterator);

                let offset: number;
                let height: number;

                if (node.value.type === "Item") {
                    assert(nodeIndex === 0);

                    // If the item key changed from what we have in state then we need to set a new
                    // entry in our state with a new key and new height.
                    if (node.value.key !== item.key) {
                        state = VirtualizedScrollViewState._setEntry(
                            state,
                            node.key,
                            {
                                type: "Item",
                                key: item.key,
                                height: item.minHeight,
                            },
                            getItem,
                        );
                    }

                    offset = nodeOffset;
                    height = node.value.key === item.key ? node.value.height : item.minHeight;
                }
                // If the index is in a buffer, we need to split the buffer in half to add an
                // entry for the additional item we're rendering.
                else {
                    const newBufferedItemCountBefore = nodeIndex;
                    const newBufferedItemCountAfter = node.value.itemCount - nodeIndex - 1;

                    let previousNode: TreeNode<OrderKey, VirtualizedScrollViewStateEntry> | null =
                        null;
                    let nextNode: TreeNode<OrderKey, VirtualizedScrollViewStateEntry> | null = null;

                    if (iterator.hasPrev) {
                        iterator.prev();
                        previousNode = iterator.node;
                        iterator.next();
                    }

                    if (iterator.hasNext) {
                        iterator.next();
                        nextNode = iterator.node;
                    }

                    state = VirtualizedScrollViewState._setEntry(
                        state,
                        node.key,
                        {
                            type: "Item",
                            key: item.key,
                            height: item.minHeight,
                        },
                        getItem,
                    );

                    if (newBufferedItemCountBefore > 0) {
                        state = VirtualizedScrollViewState._setEntry(
                            state,
                            generateOrderKeyBetween(previousNode?.key ?? null, node.key),
                            {
                                type: "Buffer",
                                itemCount: newBufferedItemCountBefore,
                            },
                            getItem,
                        );
                    }

                    if (newBufferedItemCountAfter > 0) {
                        state = VirtualizedScrollViewState._setEntry(
                            state,
                            generateOrderKeyBetween(node.key, nextNode?.key ?? null),
                            {
                                type: "Buffer",
                                itemCount: newBufferedItemCountAfter,
                            },
                            getItem,
                        );
                    }

                    offset = nodeOffset + newBufferedItemCountBefore * state._bufferedItemHeight;
                    height = item.minHeight;
                }

                const renderedItem = item.render({
                    offset,
                    height,
                    getIndexPosition: searchIndex => {
                        // NOTE(calebmer): We do not allow this because we are not done laying out items
                        // after this one. We could implement this by laying out all items first then
                        // calling `render()`.
                        if (searchIndex > index)
                            throw new UnimplementedError(
                                "Can not get the offset for an index after the item index",
                            );

                        return getIndexPosition(searchIndex);
                    },
                });

                children.push(renderedItem);
            }
        }

        return {
            state,
            children,
            contentHeight: state.getContentHeight(),
            bufferedHeightBeforeChildren,
            renderedRange: startIndex !== endIndex ? {startIndex, endIndex: endIndex - 1} : null,
        };
    }

    private static _setEntry(
        state: VirtualizedScrollViewState,
        orderKey: OrderKey,
        entry: VirtualizedScrollViewStateEntry,
        getItem: (index: number) => {key: Key; minHeight: number},
    ): VirtualizedScrollViewState {
        let entryByOrderKey = state._entryByOrderKey;
        let orderKeyByItemKey = state._orderKeyByItemKey;

        // We may recursively call this function so create an intermediate function
        // definition.
        const setEntry = (orderKey: OrderKey, entry: VirtualizedScrollViewStateEntry) => {
            // If we are replacing an item then add the `itemKey -> orderKey` association.
            if (entry.type === "Item") {
                const iterator2 = orderKeyByItemKey.find(entry.key);

                orderKeyByItemKey = iterator2.valid
                    ? iterator2.update(orderKey)
                    : orderKeyByItemKey.insert(entry.key, orderKey);

                // If this item already existed in the list, then replace the item in the old
                // position with a buffer. This maintains the item count in the list. Maybe we
                // swapped positions with another item?
                if (iterator2.node) {
                    const iterator3 = entryByOrderKey.find(iterator2.node.value);

                    // Reuse the height from the old, measured, item in the new entry instead of
                    // using a `minHeight`.
                    assert(iterator3.node?.value.type === "Item");
                    entry = {...entry, height: iterator3.node.value.height};

                    if (iterator2.node.value !== orderKey) {
                        entryByOrderKey = iterator3.update({type: "Buffer", itemCount: 1});

                        // We can not leave a buffer in the rendered range. So if the order key we are
                        // replacing is in the rendered range, get the actual item at this position and
                        // place it there instead.
                        //
                        // This should not recurse forever if `getItem()` returns unique key values for
                        // each index. We have a validation in `render()` and `updatedRenderedRange()`
                        // that checks that every index has a unique key which means we should not need
                        // to check for cycles here.
                        if (
                            state._renderedRange &&
                            state._renderedRange.startOrderKey <= iterator2.node.value &&
                            iterator2.node.value <= state._renderedRange.endOrderKey
                        ) {
                            const index = state._getPreviousItemCount(iterator3);
                            const newItem = getItem(index);
                            setEntry(iterator2.node.value, {
                                type: "Item",
                                key: newItem.key,
                                height: newItem.minHeight,
                            });
                        }
                    }
                }
            }

            // Replace the entry at the provided order key.
            //
            // We do this last so we can reassign `entry` in the above branch.
            const iterator1 = entryByOrderKey.find(orderKey);
            entryByOrderKey = iterator1.valid
                ? iterator1.update(entry)
                : entryByOrderKey.insert(orderKey, entry);

            // If there was previously an item at the order key, remove the
            // `itemKey -> orderKey` association.
            if (iterator1.value?.type === "Item") {
                orderKeyByItemKey = orderKeyByItemKey.remove(iterator1.value.key);
            }
        };

        setEntry(orderKey, entry);

        return new VirtualizedScrollViewState({
            viewHeight: state._viewHeight,
            bufferedItemHeight: state._bufferedItemHeight,
            entryByOrderKey,
            orderKeyByItemKey,
            renderedRange: state._renderedRange,
            itemCountCache: state._itemCountCache,
            contentHeightCache: state._contentHeightCache,
        });
    }

    private static _deleteEntry(
        state: VirtualizedScrollViewState,
        orderKey: OrderKey,
        {
            newRenderedRange,
        }: {
            /**
             * If you want to update the rendered range at the same time, you may pass this
             * property in.
             */
            newRenderedRange?: VirtualizedScrollViewStateRenderedRange | null;
        } = {},
    ): VirtualizedScrollViewState {
        // Replace the entry at the provided order key.
        const iterator1 = state._entryByOrderKey.find(orderKey);
        const entryByOrderKey = iterator1.remove();

        let orderKeyByItemKey = state._orderKeyByItemKey;

        // If there was previously an item at the order key, remove the
        // `itemKey -> orderKey` association.
        if (iterator1.value?.type === "Item") {
            orderKeyByItemKey = orderKeyByItemKey.remove(iterator1.value.key);
        }

        return new VirtualizedScrollViewState({
            viewHeight: state._viewHeight,
            bufferedItemHeight: state._bufferedItemHeight,
            entryByOrderKey,
            orderKeyByItemKey,
            renderedRange: newRenderedRange !== undefined ? newRenderedRange : state._renderedRange,
            itemCountCache: state._itemCountCache,
            contentHeightCache: state._contentHeightCache,
        });
    }

    /**
     * Gets the node at the provided index. The returned iterator is guaranteed to
     * have a non-null `node` property otherwise we will throw an out of range
     * error.
     *
     * If the node covers multiple indexes then we will provide a `nodeIndex` which
     * is the index within the node. If node only covers one index the `nodeIndex`
     * will always be zero.
     */
    private _getNodeAtIndex(index: number): {
        iterator: TreeIterator<OrderKey, VirtualizedScrollViewStateEntry>;
        nodeIndex: number;
    } {
        const stack: Array<TreeNode<OrderKey, VirtualizedScrollViewStateEntry>> = [];

        const search = (
            index: number,
            node: TreeNode<OrderKey, VirtualizedScrollViewStateEntry> | null,
        ): {
            node: TreeNode<OrderKey, VirtualizedScrollViewStateEntry>;
            nodeIndex: number;
        } | null => {
            if (!node) return null;
            stack.push(node);

            const valueItemCount = node.value.type === "Item" ? 1 : node.value.itemCount;
            const leftItemCount = this._getSubtreeItemCount(node.left);

            // If the index is in our node then hooray! Return this node and the index.
            //
            // Otherwise the index is either in the left subtree or right subtree of this
            // node. Find the appropriate subtree and recurse.
            if (leftItemCount <= index && index < leftItemCount + valueItemCount) {
                return {node, nodeIndex: index - leftItemCount};
            } else if (index < leftItemCount) {
                return search(index, node.left);
            } else {
                assert(leftItemCount + valueItemCount <= index);
                return search(index - (leftItemCount + valueItemCount), node.right);
            }
        };

        const searchResult = search(index, this._entryByOrderKey.root);
        if (!searchResult) throw new OutOfRangeError("Index out of bounds");

        // HACK(calebmer): Hackishly get the constructor for a
        // `functional-red-black-tree` iterator and construct it since there's not an
        // official API. This happens to be a tiny bit more efficient than calling
        // `tree.find()` with the node returned from `search()` given we already know
        // the node stack.
        const iterator: TreeIterator<OrderKey, VirtualizedScrollViewStateEntry> = new (
            this._entryByOrderKey.begin as any
        ).constructor(this._entryByOrderKey, stack);

        return {
            iterator,
            nodeIndex: searchResult.nodeIndex,
        };
    }
}

type VirtualizedScrollViewStateRenderedRange = {
    readonly startOrderKey: OrderKey;
    readonly endOrderKey: OrderKey;
};

type VirtualizedScrollViewStateEntry =
    | VirtualizedScrollViewStateItemEntry
    | VirtualizedScrollViewStateBufferEntry;

type VirtualizedScrollViewStateItemEntry = {
    readonly type: "Item";
    readonly key: Key;
    readonly height: number;
};

type VirtualizedScrollViewStateBufferEntry = {
    readonly type: "Buffer";
    readonly itemCount: number;
};
