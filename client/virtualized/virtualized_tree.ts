import createTree, {
    Tree,
    Iterator as TreeIterator,
    Node as TreeNode,
} from "functional-red-black-tree";
import {Key} from "react";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {OrderKey, generateOrderKeysBetween} from "~/shared/helpers/sort/order_key";

/**
 * Immutable data structure for building virtualized tree UIs with
 * `<VirtualizedScrollView>`.
 *
 * UIs that can render lots of data should be virtualized so they don't crash
 * the user's browser. This means we only render items currently visible on the
 * user's screen. So you need to flatten your UIs elements into a vertically
 * stacked list. This can be difficult for tree-like structures where you have
 * a parent node that can render many children and we want to virtualize those
 * children.
 *
 * `VirtualizedTree` is here to help. You can use it to build a tree data
 * structure that flattens out to a list of virtualizable items you can pass to
 * `<VirtualizedScrollView>`. One `VirtualizedTree` object is just one level of
 * the tree, if you need multiple items you need to recursively nest
 * `VirtualizedTree`s yourself.
 *
 * The way it works is by representing the list of nodes as a binary tree. We
 * can then measure the number of items in each binary subtree and reuse those
 * measurements on update (thanks to structural sharing). Finding an item by
 * flattened index is then an O(log(n)) binary search using subtree
 * item counts.
 *
 * ### History
 *
 * This technique was originally built for forum where we have a list of posts
 * we need to virtualize then posts can render comments which we also need to
 * virtualize. The comments can also open/close so item indexes can wildly
 * change across renders. As we added more tree-like virtualized UIs we took
 * the post rendering technique and built this abstraction.
 *
 * `VirtualizedScrollViewState` uses a very similar technique for maintaining
 * knowledge about the physical state of items onscreen.
 */
export class VirtualizedTree<NodeKey extends Key, Node, Item> {
    private readonly _getNodeKey: (node: Node) => NodeKey;
    private readonly _getNodeItemCount: (node: Node) => number;
    private readonly _getNodeItem: (
        node: Node,
        nodeItemIndex: number,
        startItemIndex: number,
    ) => Item;

    /**
     * The list of nodes in our tree. But this is a tree not a list you may say.
     * Yes! It is a tree keyed by an `OrderKey`. This allows us to efficiently
     * insert items in O(log(n)) time instead of O(n) time beginning or end.
     *
     * A persistent tree data structure also allows us to do caching on ranges of
     * the list. For example, we can compute the number of items for the tree then
     * when an update happens we can reuse our computation for parts of the tree
     * that didn't change thanks to structural sharing.
     */
    private readonly _nodeByOrderKey: Tree<OrderKey, Node>;

    /**
     * A map of node keys to the position of the node in our `nodeByOrderKey` tree.
     */
    private readonly _orderKeyByNodeKey: Tree<NodeKey, OrderKey>;

    /**
     * Cache of the item count in `nodeByOrderKey` subtrees.
     */
    private readonly _itemCountSubtreeCache: WeakMap<TreeNode<OrderKey, Node>, number>;

    private constructor({
        getNodeKey,
        getNodeItemCount,
        getNodeItem,
        nodeByOrderKey,
        orderKeyByNodeKey,
        itemCountSubtreeCache,
    }: {
        getNodeKey: (node: Node) => NodeKey;
        getNodeItemCount: (node: Node) => number;
        getNodeItem: (node: Node, nodeItemIndex: number, startItemIndex: number) => Item;
        nodeByOrderKey: Tree<OrderKey, Node>;
        orderKeyByNodeKey: Tree<NodeKey, OrderKey>;
        itemCountSubtreeCache: WeakMap<TreeNode<OrderKey, Node>, number>;
    }) {
        assert(nodeByOrderKey.length === orderKeyByNodeKey.length);

        this._getNodeKey = getNodeKey;
        this._getNodeItemCount = getNodeItemCount;
        this._getNodeItem = getNodeItem;
        this._nodeByOrderKey = nodeByOrderKey;
        this._orderKeyByNodeKey = orderKeyByNodeKey;
        this._itemCountSubtreeCache = itemCountSubtreeCache;
    }

    /**
     * Create a new empty virtualized tree.
     */
    public static new<NodeKey extends Key, Node, Item>({
        getNodeKey,
        getNodeItemCount,
        getNodeItem,
    }: {
        getNodeKey: (node: Node) => NodeKey;
        getNodeItemCount: (node: Node) => number;
        getNodeItem: (node: Node, nodeItemIndex: number, startItemIndex: number) => Item;
    }): VirtualizedTree<NodeKey, Node, Item> {
        return new VirtualizedTree({
            getNodeKey,
            getNodeItemCount,
            getNodeItem,
            nodeByOrderKey: createTree(),
            orderKeyByNodeKey: createTree(),
            itemCountSubtreeCache: new WeakMap(),
        });
    }

    /**
     * The number of nodes in the tree.
     */
    public getNodeCount(): number {
        return this._nodeByOrderKey.length;
    }

    /**
     * Get the number of items in a node.
     */
    public getNodeItemCount(node: Node): number {
        return this._getNodeItemCount(node);
    }

    /**
     * Get a node in the tree by its key. Returns null if the node does not
     * exist in the tree.
     *
     * Returns the index the node's items start at. The index the node's items end
     * at is `startItemIndex + getNodeItemCount(node)`.
     */
    public getNodeByKey(nodeKey: NodeKey): {
        node: Node;
        startItemIndex: number;
    } | null {
        const orderKey = this._orderKeyByNodeKey.get(nodeKey);
        if (!orderKey) return null;

        const iterator = this._nodeByOrderKey.find(orderKey);
        assert(iterator.value, "Could not find node for order key");

        return {
            node: iterator.value,
            startItemIndex: this._getPreviousItemCount(iterator),
        };
    }

    /**
     * Get a node in the tree by its index. Returns null if the item index is
     * out of bounds.
     *
     * Returns the index the node's items start at. The index the node's items end
     * at is `startItemIndex + getNodeItemCount(node)`.
     */
    public getNodeByItemIndex(itemIndex: number): {
        node: Node;
        startItemIndex: number;
    } | null {
        const stack: Array<TreeNode<OrderKey, Node>> = [];

        const search = (
            index: number,
            node: TreeNode<OrderKey, Node> | null,
        ): {
            node: TreeNode<OrderKey, Node>;
            nodeItemIndex: number;
        } | null => {
            if (!node) return null;
            stack.push(node);

            const valueItemCount = this._getNodeItemCount(node.value);
            const leftItemCount = this._getSubtreeItemCount(node.left);

            // If the index is in our node then hooray! Return this node and the index
            // relative to the node's items.
            //
            // Otherwise the index is either in the left subtree or right subtree of this
            // node. Find the appropriate subtree and recurse.
            if (leftItemCount <= index && index < leftItemCount + valueItemCount) {
                return {node, nodeItemIndex: index - leftItemCount};
            } else if (index < leftItemCount) {
                return search(index, node.left);
            } else {
                assert(leftItemCount + valueItemCount <= index);
                return search(index - (leftItemCount + valueItemCount), node.right);
            }
        };

        const searchResult = search(itemIndex, this._nodeByOrderKey.root);
        if (!searchResult) return null;

        return {
            node: searchResult.node.value,
            startItemIndex: itemIndex - searchResult.nodeItemIndex,
        };
    }

    /**
     * Get the number of items in the provided subtree.
     *
     * WARNING: If you want to get the count of all items before the node you
     * are looking at, do not use `_getSubtreeItemCount(iterator.node.left)`,
     * instead use `_getPreviousItemCount(iterator)`. The former does not count
     * items in parent nodes.
     *
     * This function is cached and takes advantage of the structural sharing in our
     * binary tree. When the tree is updated, some subtrees are left untouched so
     * we maintain the cached value for those subtrees. Running this function on a
     * new tree is O(n) but running this function on an updated tree is O(log(n)).
     */
    private _getSubtreeItemCount(node: TreeNode<OrderKey, Node> | null): number {
        if (node === null) return 0;

        let itemCount = this._itemCountSubtreeCache.get(node);

        if (itemCount === undefined) {
            const valueItemCount = this._getNodeItemCount(node.value);
            assert(valueItemCount > 0, "Node must have at least one item");

            const leftItemCount = node.left !== null ? this._getSubtreeItemCount(node.left) : 0;
            const rightItemCount = node.right !== null ? this._getSubtreeItemCount(node.right) : 0;

            itemCount = leftItemCount + valueItemCount + rightItemCount;
            this._itemCountSubtreeCache.set(node, itemCount);
        }

        return itemCount;
    }

    /**
     * Get the item count of all entries before the node the iterator is
     * looking at.
     */
    private _getPreviousItemCount(iterator: TreeIterator<OrderKey, Node>): number {
        if (!iterator.node) return 0;
        let itemCount = this._getSubtreeItemCount(iterator.node.left);
        const beforeOrderKey = iterator.node.key;

        for (let i = iterator._stack.length - 2; i >= 0; i--) {
            const parentNode = iterator._stack[i]!;

            if (parentNode.key < beforeOrderKey) {
                itemCount += this._getNodeItemCount(parentNode.value);
                itemCount += this._getSubtreeItemCount(parentNode.left);
            }
        }

        return itemCount;
    }

    /**
     * The total number of items in our tree. Will be greater than the number of
     * nodes since it includes all the nodes' child items.
     */
    public getItemCount(): number {
        return this._getSubtreeItemCount(this._nodeByOrderKey.root);
    }

    /**
     * Get the item at the provided index. Returns null if the index is out of bounds.
     */
    public getItem(itemIndex: number): Item | null {
        const nodeResult = this.getNodeByItemIndex(itemIndex);
        if (!nodeResult) return null;
        const {node, startItemIndex} = nodeResult;
        return this._getNodeItem(node, itemIndex - startItemIndex, startItemIndex);
    }

    /**
     * Insert some nodes at the start of the tree. Node keys must be unique and
     * shouldn't match the keys of nodes already in the tree.
     */
    public insertNodesAtStart(nodes: ReadonlyArray<Node>): VirtualizedTree<NodeKey, Node, Item> {
        const orderKeys = generateOrderKeysBetween(
            null,
            this._nodeByOrderKey.begin.key ?? null,
            nodes.length,
        );

        let nodeByOrderKey = this._nodeByOrderKey;
        let orderKeyByNodeKey = this._orderKeyByNodeKey;

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i]!;
            const nodeKey = this._getNodeKey(node);
            const orderKey = orderKeys[i]!;

            nodeByOrderKey = nodeByOrderKey.insert(orderKey, node);

            const oldOrderKey = orderKeyByNodeKey.get(nodeKey);
            assert(!oldOrderKey, "Node with key already exists in the tree");
            orderKeyByNodeKey = orderKeyByNodeKey.insert(nodeKey, orderKey);
        }

        return new VirtualizedTree({
            getNodeKey: this._getNodeKey,
            getNodeItemCount: this._getNodeItemCount,
            getNodeItem: this._getNodeItem,
            nodeByOrderKey,
            orderKeyByNodeKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }

    /**
     * Insert some nodes at the end of the tree. Node keys must be unique and
     * shouldn't match the keys of nodes already in the tree.
     */
    public insertNodesAtEnd(nodes: ReadonlyArray<Node>): VirtualizedTree<NodeKey, Node, Item> {
        const orderKeys = generateOrderKeysBetween(
            this._nodeByOrderKey.end.key ?? null,
            null,
            nodes.length,
        );

        let nodeByOrderKey = this._nodeByOrderKey;
        let orderKeyByNodeKey = this._orderKeyByNodeKey;

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i]!;
            const nodeKey = this._getNodeKey(node);
            const orderKey = orderKeys[i]!;

            nodeByOrderKey = nodeByOrderKey.insert(orderKey, node);

            const oldOrderKey = orderKeyByNodeKey.get(nodeKey);
            assert(!oldOrderKey, "Node with key already exists in the tree");
            orderKeyByNodeKey = orderKeyByNodeKey.insert(nodeKey, orderKey);
        }

        return new VirtualizedTree({
            getNodeKey: this._getNodeKey,
            getNodeItemCount: this._getNodeItemCount,
            getNodeItem: this._getNodeItem,
            nodeByOrderKey,
            orderKeyByNodeKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }

    /**
     * Updates a node at the specified key. If a node for that key does not exist
     * then this method does nothing. If the node's key changes then we will
     * also throw an error.
     */
    public updateNode(
        nodeKey: NodeKey,
        update: (node: Node) => Node,
    ): VirtualizedTree<NodeKey, Node, Item> {
        const orderKey = this._orderKeyByNodeKey.get(nodeKey);
        if (!orderKey) return this;

        const iterator = this._nodeByOrderKey.find(orderKey);
        assert(iterator.value, "Could not find node for order key");

        const newNode = update(iterator.value);
        if (newNode === iterator.value) return this;

        const newNodeKey = this._getNodeKey(newNode);
        if (nodeKey !== newNodeKey) throw new InternalError("Can not change node key in an update");

        const nodeByOrderKey = iterator.update(newNode);

        return new VirtualizedTree({
            getNodeKey: this._getNodeKey,
            getNodeItemCount: this._getNodeItemCount,
            getNodeItem: this._getNodeItem,
            nodeByOrderKey,
            orderKeyByNodeKey: this._orderKeyByNodeKey,
            itemCountSubtreeCache: this._itemCountSubtreeCache,
        });
    }
}
