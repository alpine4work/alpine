import {Tree, Node as TreeNode} from "functional-red-black-tree";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {StoreMap} from "~/client/helpers/store/store_map.js";
import {flatMapTreeStoreValues} from "~/client/helpers/store/tree_store.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {VirtualizedScrollViewItem} from "~/client/virtualized/virtualized_scroll_view.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskQuerySortCursor,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";

// NOCOMMIT: Document! Should probably be in a different file.
export type TaskGridViewTaskKey = TaskId | `${TaskId}-${TaskId}`;

/**
 * Tree of tasks that will be rendered by a task virtualized grid view. Parent
 * tasks may have expanded child tasks and those child tasks may themselves
 * have expanded children. This naturally forms a tree.
 *
 * `<VirtualizedScrollView>` needs a flat list so we wrap this with
 * `TaskGridViewVirtualizedList` which provides a flat interface to the tree.
 *
 * Keys represent the task at this position. Represented with a
 * `TaskQuerySortCursor` to maintain the proper sort order. Values represent
 * expanded children or null if children aren't expanded.
 */
type TaskGridViewVirtualizedTaskTree = Tree<
    TaskQuerySortCursor,
    TaskGridViewVirtualizedTaskTreeValue
>;

// NOCOMMIT: If we have fewer child tasks than what's reported by the task we
// should have some unloaded items.
type TaskGridViewVirtualizedTaskTreeValue =
    // Task children are expanded and loaded
    | TaskGridViewVirtualizedTaskTree
    // Task children are expanded but unloaded
    | number
    // Task children are collapsed
    | null;

const nullConstStore = new ConstStore(null);

function createTaskGridViewVirtualizedTaskTree(
    store: TaskClientStore,
    query: TaskClientQuery,
    isExpandedByTaskKey: StoreMap<TaskGridViewTaskKey, boolean>,
    rootTaskId: TaskId | null,
): Store<TaskGridViewVirtualizedTaskTree> {
    return flatMapTreeStoreValues(query.taskOrderStore, (_null, cursor) => {
        const taskId = getTaskQuerySortCursorTaskId(cursor);
        const taskKey: TaskGridViewTaskKey = rootTaskId ? `${rootTaskId}-${taskId}` : taskId;

        return isExpandedByTaskKey
            .get(taskKey)
            .flatMap((isExpanded): Store<TaskGridViewVirtualizedTaskTreeValue> => {
                if (!isExpanded) return nullConstStore;

                // NOCOMMIT: `getTaskChildrenQueryIfExists()` needs to be behind a store! So
                // that when the children query loads this updates.
                const childrenQuery = store.getTaskChildrenQueryIfExists(taskId);
                if (childrenQuery) {
                    return createTaskGridViewVirtualizedTaskTree(
                        store,
                        childrenQuery,
                        isExpandedByTaskKey,
                        rootTaskId ?? taskId,
                    );
                }

                const taskEntryStore = query.getTaskEntryStore(taskId);
                return taskEntryStore.map(taskEntry => taskEntry.task?.getChildTaskCount() ?? 0);
            });
    });
}

export type TaskGridViewVirtualizedTaskListItem =
    | {
          readonly type: "Task";
          readonly rootTaskId: TaskId | null;
          readonly taskId: TaskId;
          readonly indentation: number;
      }
    | {
          readonly type: "UnloadedChildTask";
          readonly rootTaskId: TaskId | null;
          readonly parentTaskId: TaskId;
          readonly childTaskIndex: number;
          readonly indentation: number;
      };

/**
 * Flat list of tasks in a grid view for rendering with a
 * `<VirtualizedScrollView>`. While tasks form a naturally nested structure, we
 * need to flatten them for virtualization.
 *
 * This class only contains the actual tasks in the grid view. Not the ghost
 * tasks or decorative tasks like `useTaskGridViewVirtualizedList()`.
 *
 * This class's implementation is derived from `VirtualizedTree`. It didn't
 * make sense to use `VirtualizedTree` itself because order was determined by
 * `OrderKey`s (and we want to use `TaskQuerySortCursor`) but we're using the
 * same subtree item count caching technique to make re-rendering after a
 * change O(log(n)) instead of O(n).
 */
export class TaskGridViewVirtualizedTaskList {
    private readonly _tree: TaskGridViewVirtualizedTaskTree;

    /**
     * Cache of the item count in `tree` subtrees.
     */
    private readonly _itemCountSubtreeCache: WeakMap<
        TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue>,
        number
    >;

    private constructor(
        tree: TaskGridViewVirtualizedTaskTree,
        itemCountSubtreeCache: WeakMap<
            TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue>,
            number
        >,
    ) {
        this._tree = tree;
        this._itemCountSubtreeCache = itemCountSubtreeCache;
    }

    public static new(
        store: TaskClientStore,
        query: TaskClientQuery,
        isExpandedByTaskKey: StoreMap<TaskGridViewTaskKey, boolean>,
    ): Store<TaskGridViewVirtualizedTaskList> {
        // Share the item count subtree cache across all virtualized lists that
        // are created.
        const itemCountSubtreeCache = new WeakMap<
            TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue>,
            number
        >();

        return createTaskGridViewVirtualizedTaskTree(store, query, isExpandedByTaskKey, null).map(
            tree => new TaskGridViewVirtualizedTaskList(tree, itemCountSubtreeCache),
        );
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
    // NOTE(calebmer, 2023-09-06): The referenced `_getPreviousItemCount(iterator)`
    // function is not currently implemented. See `VirtualizedScrollViewState` for
    // a reference implementation.
    private _getSubtreeItemCount(
        node: TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue> | null,
    ): number {
        if (node === null) return 0;

        let valueItemCount: number;
        if (node.value === null) {
            valueItemCount = 1;
        } else if (typeof node.value === "number") {
            valueItemCount = 1 + node.value;
        } else {
            valueItemCount = 1 + this._getSubtreeItemCount(node.value.root);
        }

        // Don't spend memory caching nodes with no subtrees.
        if (node.left === null && node.right === null) return valueItemCount;

        let itemCount = this._itemCountSubtreeCache.get(node);

        if (itemCount === undefined) {
            const leftItemCount = node.left !== null ? this._getSubtreeItemCount(node.left) : 0;
            const rightItemCount = node.right !== null ? this._getSubtreeItemCount(node.right) : 0;

            itemCount = leftItemCount + valueItemCount + rightItemCount;
            this._itemCountSubtreeCache.set(node, itemCount);
        }

        return itemCount;
    }

    /**
     * The total number of items in our tree. Includes all expanded child tasks.
     */
    public getItemCount(): number {
        return this._getSubtreeItemCount(this._tree.root);
    }

    /**
     * Get the item at the specified index. If you try to access an item outside of
     * this list's bounds you'll get an error.
     */
    public getItem(itemIndex: number): TaskGridViewVirtualizedTaskListItem {
        // Binary search to find the item...
        const search = (
            index: number,
            node: TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue> | null,
            rootTaskId: TaskId | null,
            indentation: number,
        ): TaskGridViewVirtualizedTaskListItem | null => {
            if (!node) return null;

            let valueItemCount: number;
            if (node.value === null) {
                valueItemCount = 1;
            } else if (typeof node.value === "number") {
                valueItemCount = 1 + node.value;
            } else {
                valueItemCount = 1 + this._getSubtreeItemCount(node.value.root);
            }

            const leftItemCount = this._getSubtreeItemCount(node.left);

            // If the index is not in our node then recurse into either the left or right
            // subtree.
            if (index < leftItemCount) {
                return search(index, node.left, rootTaskId, indentation);
            } else if (leftItemCount + valueItemCount <= index) {
                return search(
                    index - (leftItemCount + valueItemCount),
                    node.right,
                    rootTaskId,
                    indentation,
                );
            } else {
                assert(leftItemCount <= index && index < leftItemCount + valueItemCount);

                if (leftItemCount === index) {
                    return {
                        type: "Task",
                        rootTaskId,
                        taskId: getTaskQuerySortCursorTaskId(node.key),
                        indentation,
                    };
                }

                // `null` values have only 1 item and it's the task item.
                assert(node.value !== null);

                if (typeof node.value === "number") {
                    const childTaskIndex = index - leftItemCount - 1;
                    assert(0 <= childTaskIndex && childTaskIndex < node.value);

                    return {
                        type: "UnloadedChildTask",
                        rootTaskId,
                        parentTaskId: getTaskQuerySortCursorTaskId(node.key),
                        childTaskIndex,
                        indentation,
                    };
                } else {
                    return search(
                        index - leftItemCount - 1,
                        node.value.root,
                        rootTaskId ?? getTaskQuerySortCursorTaskId(node.key),
                        indentation + 1,
                    );
                }
            }
        };

        return assertExists(search(itemIndex, this._tree.root, null, 0));
    }

    public renderItem(itemIndex: number): VirtualizedScrollViewItem {
        const item = this.getItem(itemIndex);
        throw new UnimplementedError("NOCOMMIT");
    }
}
