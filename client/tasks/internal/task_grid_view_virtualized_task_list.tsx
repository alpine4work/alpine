import {Tree, Node as TreeNode} from "functional-red-black-tree";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {StoreMap} from "~/client/helpers/store/store_map.js";
import {flatMapTreeStoreValues} from "~/client/helpers/store/tree_store.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskQuerySortCursor,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";

/**
 * The key of a task in a grid view. Tasks are unique within a query but
 * because you may expand a task's children a task might not be unique in a
 * grid view. Since you could have a task in the root query and a task visible
 * in an expanded parent.
 *
 * So the way we key tasks in a grid view is by saying a task in the root query
 * has the key `TaskId`. Then child tasks have a key that's their root parent
 * task in the query (not the same as the root parent task, just the highest
 * task in the query) combined with their `TaskId`. Since tasks within a child
 * task tree are always unique.
 *
 * This key will be unique for any task within the grid view. Unfortunately it
 * does mean when indenting/dedenting between root tasks and child tasks our
 * task's key changes so React will need to remount the component. For those
 * operations we take care to place focus in the new task.
 */
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
    TaskGridViewVirtualizedTaskTreeValue | null
>;

type TaskGridViewVirtualizedTaskTreeValue = {
    readonly children: TaskGridViewVirtualizedTaskTree | null;
    readonly unloadedChildTaskCount: number;
};

const nullConstStore = new ConstStore(null);

function createTaskGridViewVirtualizedTaskTree(
    query: TaskClientQuery,
    areChildTasksExpandedByTaskKey: StoreMap<TaskGridViewTaskKey, boolean>,
    rootTaskId: TaskId | null,
): Store<TaskGridViewVirtualizedTaskTree> {
    return flatMapTreeStoreValues(query.taskOrderStore, (_null, cursor) => {
        const taskId = getTaskQuerySortCursorTaskId(cursor);
        const taskKey: TaskGridViewTaskKey = rootTaskId ? `${rootTaskId}-${taskId}` : taskId;

        // It's a rare edge case but it is possible for there to be a temporary cycle
        // among task children. If we detect a child task with the same `TaskId` as our
        // root task that means we have a cycle. Break it by returning a null store.
        if (rootTaskId === taskId) {
            return nullConstStore;
        }

        return areChildTasksExpandedByTaskKey.get(taskKey).flatMap(areChildTasksExpanded => {
            if (!areChildTasksExpanded) return nullConstStore;

            // Optimization: Only recompute if the child task count changed.
            const childTaskCountStore = query
                .getTaskEntryStore(taskId)
                .map(({task}) => task?.getChildTaskCount() ?? 0);

            return childTaskCountStore.flatMap(childTaskCount => {
                // Tasks with no children are always treated as collapsed.
                if (childTaskCount === 0) return nullConstStore;

                const childrenQueryStore = query.store.getTaskChildrenQueryStore(taskId);
                return childrenQueryStore.flatMap(childrenQuery => {
                    if (!childrenQuery) {
                        return new ConstStore({
                            children: null,
                            unloadedChildTaskCount: childTaskCount,
                        });
                    }

                    return createTaskGridViewVirtualizedTaskTree(
                        childrenQuery,
                        areChildTasksExpandedByTaskKey,
                        rootTaskId ?? taskId,
                    ).map(
                        (children): TaskGridViewVirtualizedTaskTreeValue => ({
                            children,
                            // The query might not have loaded all child tasks. We'll need to render some
                            // unloaded task items if that's the case.
                            unloadedChildTaskCount: Math.max(0, childTaskCount - children.length),
                        }),
                    );
                });
            });
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
    private readonly _query: TaskClientQuery;
    private readonly _tree: TaskGridViewVirtualizedTaskTree;

    /**
     * Cache of the item count in `tree` subtrees.
     */
    private readonly _itemCountSubtreeCache: WeakMap<
        TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>,
        number
    >;

    private constructor(
        query: TaskClientQuery,
        tree: TaskGridViewVirtualizedTaskTree,
        itemCountSubtreeCache: WeakMap<
            TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>,
            number
        >,
    ) {
        this._query = query;
        this._tree = tree;
        this._itemCountSubtreeCache = itemCountSubtreeCache;
    }

    public static new(
        query: TaskClientQuery,
        areChildTasksExpandedByTaskKey: StoreMap<TaskGridViewTaskKey, boolean>,
    ): Store<TaskGridViewVirtualizedTaskList> {
        // Share the item count subtree cache across all virtualized lists that
        // are created.
        const itemCountSubtreeCache = new WeakMap<
            TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>,
            number
        >();

        return createTaskGridViewVirtualizedTaskTree(
            query,
            areChildTasksExpandedByTaskKey,
            null,
        ).map(tree => new TaskGridViewVirtualizedTaskList(query, tree, itemCountSubtreeCache));
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
        node: TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null> | null,
    ): number {
        if (node === null) return 0;

        let valueItemCount: number;
        if (node.value === null) {
            valueItemCount = 1;
        } else {
            valueItemCount =
                1 +
                (node.value.children !== null
                    ? this._getSubtreeItemCount(node.value.children.root)
                    : 0) +
                node.value.unloadedChildTaskCount;
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
            node: TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null> | null,
            rootTaskId: TaskId | null,
            indentation: number,
        ): TaskGridViewVirtualizedTaskListItem | null => {
            if (!node) return null;

            let valueItemCount: number;
            if (node.value === null) {
                valueItemCount = 1;
            } else {
                valueItemCount =
                    1 +
                    (node.value.children !== null
                        ? this._getSubtreeItemCount(node.value.children.root)
                        : 0) +
                    node.value.unloadedChildTaskCount;
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

                const childrenItemCount =
                    node.value.children !== null
                        ? this._getSubtreeItemCount(node.value.children.root)
                        : 0;

                const childTaskIndex = index - leftItemCount - 1;
                assert(0 <= childTaskIndex);

                if (childTaskIndex >= childrenItemCount) {
                    return {
                        type: "UnloadedChildTask",
                        rootTaskId,
                        parentTaskId: getTaskQuerySortCursorTaskId(node.key),
                        childTaskIndex: childTaskIndex - childrenItemCount,
                        indentation: indentation + 1,
                    };
                } else {
                    return search(
                        index - leftItemCount - 1,
                        node.value.children!.root,
                        rootTaskId ?? getTaskQuerySortCursorTaskId(node.key),
                        indentation + 1,
                    );
                }
            }
        };

        return assertExists(search(itemIndex, this._tree.root, null, 0));
    }
}
