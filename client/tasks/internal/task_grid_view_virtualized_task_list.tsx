import createTree, {
    Tree,
    Iterator as TreeIterator,
    Node as TreeNode,
} from "functional-red-black-tree";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {flatMapTreeStoreValues} from "~/client/helpers/store/tree_store.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {OutOfRangeError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskQuerySortCursor,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";

// HACK(calebmer): Hackishly get the constructor for a
// `functional-red-black-tree` iterator so we can construct it since there's
// not an official API. This happens to be a tiny bit more efficient than
// calling `tree.find()` with the node returned from `search()` given we
// already know the node stack.
const unsafe_TreeIterator: {
    new <K, V>(tree: Tree<K, V>, stack: Array<TreeNode<K, V>>): TreeIterator<K, V>;
} = createTree().begin.constructor as any;

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
    readonly children: {
        readonly query: TaskClientQuery;
        readonly tasks: TaskGridViewVirtualizedTaskTree;
    } | null;
    readonly unloadedChildTaskCount: number;
};

const nullConstStore = new ConstStore(null);

function createTaskGridViewVirtualizedTaskTree(
    query: TaskClientQuery,
    getAreChildTasksExpandedStore: (taskPath: ReadonlyArray<TaskId>) => Store<true | undefined>,
    taskPath: ReadonlyArray<TaskId>,
): Store<TaskGridViewVirtualizedTaskTree> {
    return flatMapTreeStoreValues(query.taskOrderStore, (_null, cursor) => {
        const taskId = getTaskQuerySortCursorTaskId(cursor);

        // It's a rare edge case but it is possible for there to be a temporary cycle
        // among task children. If we detect a child task with the same `TaskId` as our
        // root task that means we have a cycle. Break it by returning a null store.
        if (taskPath.length > 0 && taskPath[0] === taskId) {
            return nullConstStore;
        }

        const newTaskPath = [...taskPath, taskId];

        // IMPORTANT: We are being very careful here to avoid taking a dependency
        // on anything that would cause the entire task order tree to invalidate should
        // it update. Try to avoid adding any such dependencies for common operations.

        return getAreChildTasksExpandedStore(newTaskPath).flatMap(areChildTasksExpanded => {
            if (!areChildTasksExpanded) return nullConstStore;

            // Optimization: Only recompute if the child task count changed.
            const childTaskCountStore = query
                .getLoadedTaskEntryStore(taskId)
                .map(({task}) => task?.getChildTaskCount() ?? 0);

            return childTaskCountStore.flatMap(childTaskCount => {
                // Tasks with no children are always treated as collapsed.
                if (childTaskCount === 0) return nullConstStore;

                const taskChildrenQueryStore = query.store.getTaskChildrenQueryStore(taskId);
                return taskChildrenQueryStore.flatMap(taskChildrenQuery => {
                    if (!taskChildrenQuery) {
                        return new ConstStore({
                            children: null,
                            unloadedChildTaskCount: childTaskCount,
                        });
                    }

                    return createTaskGridViewVirtualizedTaskTree(
                        taskChildrenQuery,
                        getAreChildTasksExpandedStore,
                        newTaskPath,
                    ).map(
                        (childTasks): TaskGridViewVirtualizedTaskTreeValue => ({
                            children: {
                                query: taskChildrenQuery,
                                tasks: childTasks,
                            },
                            // The query might not have loaded all child tasks. We'll need to render some
                            // unloaded task items if that's the case.
                            unloadedChildTaskCount: Math.max(0, childTaskCount - childTasks.length),
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
          // If this is a child task we need to read data from the child task query, not
          // the root query. We set this property to the query the `taskId` lives in.
          readonly query: TaskClientQuery;
          readonly parentTaskCursors: ReadonlyArray<TaskQuerySortCursor>;
          readonly cursor: TaskQuerySortCursor;
      }
    | {
          readonly type: "UnloadedChildTask";
          readonly parentTaskCursors: ReadonlyArray<TaskQuerySortCursor>;
          readonly unloadedChildTaskIndex: number;
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
        getAreChildTasksExpandedStore: (taskPath: ReadonlyArray<TaskId>) => Store<true | undefined>,
    ): Store<TaskGridViewVirtualizedTaskList> {
        // Share the item count subtree cache across all virtualized lists that
        // are created.
        const itemCountSubtreeCache = new WeakMap<
            TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>,
            number
        >();

        return createTaskGridViewVirtualizedTaskTree(query, getAreChildTasksExpandedStore, []).map(
            tree => new TaskGridViewVirtualizedTaskList(query, tree, itemCountSubtreeCache),
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
                    ? this._getSubtreeItemCount(node.value.children.tasks.root)
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

    private _iterator: {
        itemIndex: number;
        iterator: Iterator<TaskGridViewVirtualizedTaskListItem>;
    } | null = null;

    /**
     * Get the item at the specified index. If you try to access an item outside of
     * this list's bounds you'll get an error.
     *
     * When you first call this function we perform an O(log(n)) binary search to
     * determine the right item. Afterwards if you iterate forward one item at a
     * time (`getItem(n + 1)`) we internally hold an iterator so subsequent calls
     * can be O(1). Iterating backwards (`getItem(n - 1)`) is not optimized and
     * will be O(log(n)).
     */
    public getItem(itemIndex: number): TaskGridViewVirtualizedTaskListItem {
        if (this._iterator && itemIndex === this._iterator.itemIndex + 1) {
            const result = this._iterator.iterator.next();
            if (result.done) throw new OutOfRangeError("Index out of bounds");

            this._iterator.itemIndex++;

            return result.value;
        }

        const iterator = this._getItem(itemIndex);

        const result = iterator.next();
        if (result.done) throw new OutOfRangeError("Index out of bounds");

        this._iterator = {
            itemIndex,
            iterator,
        };

        return result.value;
    }

    private _getItem(itemIndex: number) {
        const stack: Array<{
            query: TaskClientQuery;
            cursor: TaskQuerySortCursor;
            iterator: TreeIterator<
                TaskQuerySortCursor,
                TaskGridViewVirtualizedTaskTreeValue | null
            >;
            nextPhase: "Enter" | "ExitChildren";
        }> = [];

        // Binary search to find the item...
        const search = (
            index: number,
            tree: Tree<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>,
            node: TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null> | null,
            query: TaskClientQuery,
            nodeStack: Array<
                TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>
            >,
        ): IterableIterator<TaskGridViewVirtualizedTaskListItem> => {
            if (!node) throw new OutOfRangeError("Index out of bounds");
            nodeStack?.push(node);

            let valueItemCount: number;
            if (node.value === null) {
                valueItemCount = 1;
            } else {
                valueItemCount =
                    1 +
                    (node.value.children !== null
                        ? this._getSubtreeItemCount(node.value.children.tasks.root)
                        : 0) +
                    node.value.unloadedChildTaskCount;
            }

            const leftItemCount = this._getSubtreeItemCount(node.left);

            // If the index is not in our node then recurse into either the left or right
            // subtree.
            if (index < leftItemCount) {
                return search(index, tree, node.left, query, nodeStack);
            } else if (leftItemCount + valueItemCount <= index) {
                return search(
                    index - (leftItemCount + valueItemCount),
                    tree,
                    node.right,
                    query,
                    nodeStack,
                );
            } else {
                assert(leftItemCount <= index && index < leftItemCount + valueItemCount);

                if (leftItemCount === index) {
                    stack.push({
                        query,
                        cursor: node.key,
                        iterator: new unsafe_TreeIterator(tree, nodeStack),
                        nextPhase: "Enter",
                    });

                    return iterateTaskGridViewVirtualizedTaskListItems(stack, null);
                }

                // `null` values have only 1 item and it's the task item.
                assert(node.value !== null);

                const childrenItemCount =
                    node.value.children !== null
                        ? this._getSubtreeItemCount(node.value.children.tasks.root)
                        : 0;

                const childTaskIndex = index - leftItemCount - 1;
                assert(0 <= childTaskIndex);

                if (childTaskIndex >= childrenItemCount) {
                    stack.push({
                        query,
                        cursor: node.key,
                        iterator: new unsafe_TreeIterator(tree, nodeStack),
                        nextPhase: "ExitChildren",
                    });

                    return iterateTaskGridViewVirtualizedTaskListItems(
                        stack,
                        childTaskIndex - childrenItemCount,
                    );
                } else {
                    stack.push({
                        query,
                        cursor: node.key,
                        iterator: new unsafe_TreeIterator(tree, nodeStack),
                        nextPhase: "ExitChildren",
                    });

                    return search(
                        index - leftItemCount - 1,
                        node.value.children!.tasks,
                        node.value.children!.tasks.root,
                        node.value.children!.query,
                        [],
                    );
                }
            }
        };

        return assertExists(search(itemIndex, this._tree, this._tree.root, this._query, []));
    }
}

/**
 * Iterates forward through a `TaskGridViewVirtualizedTaskTree` starting
 * anywhere in the tree.
 *
 * If a node has children then the node will be visited twice. Once with the
 * `Enter` phase and once after iterating through all its children with the
 * `ExitChildren` phase.
 */
function* iterateTaskGridViewVirtualizedTaskListTreeNodes(
    stack: Array<{
        query: TaskClientQuery;
        cursor: TaskQuerySortCursor;
        iterator: TreeIterator<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>;
        nextPhase: "Enter" | "ExitChildren";
    }>,
): IterableIterator<{
    query: TaskClientQuery;
    parentTaskCursors: ReadonlyArray<TaskQuerySortCursor>;
    node: TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>;
    phase: "Enter" | "ExitChildren";
}> {
    while (stack.length > 0) {
        const stackEntry = stack.pop()!;
        const {iterator, query} = stackEntry;
        const parentTaskCursors = stack.map(({cursor}) => cursor);

        while (iterator.valid) {
            const node = iterator.node!;

            if (stackEntry.nextPhase === "ExitChildren") {
                if (node.value) {
                    yield {
                        query,
                        parentTaskCursors,
                        node,
                        phase: "ExitChildren",
                    };
                }

                stackEntry.nextPhase = "Enter";
                iterator.next();
                continue;
            }

            yield {
                query,
                parentTaskCursors,
                node,
                phase: "Enter",
            };

            // If we don't have any loaded or unloaded children we don't need to yield an
            // `ExitChildren` phase for this node.
            if (!node.value) {
                iterator.next();
            } else {
                const children = node.value.children;

                stack.push({
                    query,
                    cursor: node.key,
                    iterator,
                    nextPhase: "ExitChildren",
                });

                if (children) {
                    const childrenIterator = children.tasks.begin;

                    if (childrenIterator.valid) {
                        stack.push({
                            query: children.query,
                            cursor: childrenIterator.node!.key,
                            iterator: childrenIterator,
                            nextPhase: "Enter",
                        });
                    }
                }

                break;
            }
        }
    }
}

/**
 * Iterates through a `TaskGridViewVirtualizedTaskTree` starting anywhere in
 * the tree and emitting `TaskGridViewVirtualizedTaskListItem`s.
 *
 * If we start with a `UnloadedChildTask` then you should provide
 * `initialUnloadedChildTaskIndex`. It requires the tree node iterator to start
 * with the `ExitChildren` phase.
 */
function* iterateTaskGridViewVirtualizedTaskListItems(
    stack: Array<{
        query: TaskClientQuery;
        cursor: TaskQuerySortCursor;
        iterator: TreeIterator<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>;
        nextPhase: "Enter" | "ExitChildren";
    }>,
    initialUnloadedChildTaskIndex: number | null,
): IterableIterator<TaskGridViewVirtualizedTaskListItem> {
    const iterator = iterateTaskGridViewVirtualizedTaskListTreeNodes(stack);

    // Handle starting in the middle of some unloaded child task section:
    if (initialUnloadedChildTaskIndex !== null) {
        const result = iterator.next();
        if (result.done) return;

        const {parentTaskCursors, node, phase} = result.value;

        assert(phase !== "Enter");
        assert(node.value && node.value.unloadedChildTaskCount > 0);

        const childrenParentTaskCursors = [...parentTaskCursors, node.key];

        for (let i = initialUnloadedChildTaskIndex; i < node.value.unloadedChildTaskCount; i++) {
            yield {
                type: "UnloadedChildTask",
                parentTaskCursors: childrenParentTaskCursors,
                unloadedChildTaskIndex: i,
            };
        }

        initialUnloadedChildTaskIndex = null;
    }

    // Loop through our tree yielding `UnloadedChildTask`s when we exit a node
    // when appropriate.
    for (const {query, parentTaskCursors, node, phase} of iterator) {
        if (phase === "Enter") {
            yield {
                type: "Task",
                query,
                parentTaskCursors,
                cursor: node.key,
            };
        } else if (node.value && node.value.unloadedChildTaskCount > 0) {
            const childrenParentTaskCursors = [...parentTaskCursors, node.key];

            for (let i = 0; i < node.value.unloadedChildTaskCount; i++) {
                yield {
                    type: "UnloadedChildTask",
                    parentTaskCursors: childrenParentTaskCursors,
                    unloadedChildTaskIndex: i,
                };
            }
        }
    }
}
