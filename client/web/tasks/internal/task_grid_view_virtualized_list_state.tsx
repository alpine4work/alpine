import createTree, {
    Tree,
    Iterator as TreeIterator,
    Node as TreeNode,
} from "functional-red-black-tree";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {ParsableRemLength} from "~/shared/design/core/spacing.js";
import {OutOfRangeError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {symmetricDiffTree} from "~/shared/helpers/immutable/symmetric_diff_tree.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";
import {ConstStore, nullStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {flatMapTreeStoreValues} from "~/shared/store/tree_store.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";

export const taskAnimationDurationMs = 100;

// HACK(calebmer): Hackishly get the constructor for a `functional-red-black-tree`
// iterator so we can construct it since there's not an official API. This happens
// to be a tiny bit more efficient than calling `tree.find()` with the node
// returned from `search()` given we already know the node stack.
const unsafe_TreeIterator: {
    new <K, V>(tree: Tree<K, V>, stack: Array<TreeNode<K, V>>): TreeIterator<K, V>;
} = createTree().begin.constructor as any;

/**
 * Tree of tasks that will be rendered by a task virtualized grid view. Parent
 * tasks may have expanded child tasks and those child tasks may themselves have
 * expanded children. This naturally forms a tree.
 *
 * `<VirtualizedScrollView>` needs a flat list so we wrap this with
 * `TaskGridViewVirtualizedList` which provides a flat interface to the tree.
 *
 * Keys represent the task at this position. Represented with a
 * `TaskQuerySortCursor` to maintain the proper sort order. Values represent
 * expanded children or null if children aren't expanded.
 */
type TaskGridViewVirtualizedTaskTree = {
    readonly parents: ReadonlyArray<{
        readonly query: TaskClientQuery;
        readonly cursor: TaskQuerySortCursor;
    }>;
    readonly query: TaskClientQuery;
    readonly tasks: Tree<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>;
};

type TaskGridViewVirtualizedTaskTreeValue = {
    readonly childrenTree: TaskGridViewVirtualizedTaskTree | null;
    readonly childrenParents: ReadonlyArray<{
        readonly query: TaskClientQuery;
        readonly cursor: TaskQuerySortCursor;
    }>;
    readonly unloadedChildTaskCount: number;
};

function createTaskGridViewVirtualizedTaskTree(
    query: TaskClientQuery,
    getAreChildTasksExpandedStore: (taskPath: ReadonlyArray<TaskId>) => Store<true | undefined>,
    parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>,
    maxGridExpandableTaskDepth: number,
): Store<TaskGridViewVirtualizedTaskTree> {
    return flatMapTreeStoreValues(query.taskOrderStore, (_null, cursor) => {
        const taskId = getTaskQuerySortCursorTaskId(cursor);

        // It's a rare edge case but it is possible for there to be a temporary cycle among
        // task children. If we detect a child task with the same `TaskId` as our root task
        // that means we have a cycle. Break it by returning a null store.
        if (parents.length > 0 && getTaskQuerySortCursorTaskId(parents[0]!.cursor) === taskId) {
            return nullStore;
        }

        // Don't allow expanding tasks infinitely. You must open the task to see subtasks
        // after this depth.
        if (parents.length >= maxGridExpandableTaskDepth) {
            return nullStore;
        }

        const newParents = [...parents, {query, cursor}];

        // IMPORTANT: We are being very careful here to avoid taking a dependency on
        // anything that would cause the entire task order tree to invalidate should it
        // update. Try to avoid adding any such dependencies for common operations.

        return getAreChildTasksExpandedStore(
            newParents.map(({cursor}) => getTaskQuerySortCursorTaskId(cursor)),
        ).flatMap(areChildTasksExpanded => {
            if (!areChildTasksExpanded) return nullStore;

            const childTaskCountStore = query
                .getLoadedTaskEntryStore(taskId)
                .map(({task}) => task?.getChildTaskCount() ?? 0);

            return query.store.getTaskChildrenQueryStore(taskId).flatMap(taskChildrenQuery => {
                if (!taskChildrenQuery) {
                    return childTaskCountStore.map(childTaskCount => {
                        // Tasks with no children are always treated as collapsed.
                        if (childTaskCount === 0) return null;

                        return {
                            query,
                            parents,
                            childrenTree: null,
                            childrenParents: newParents,
                            unloadedChildTaskCount: childTaskCount,
                        };
                    });
                }

                return Store.map(
                    childTaskCountStore,
                    createTaskGridViewVirtualizedTaskTree(
                        taskChildrenQuery,
                        getAreChildTasksExpandedStore,
                        newParents,
                        maxGridExpandableTaskDepth,
                    ),
                    (childTaskCount, childrenTree): TaskGridViewVirtualizedTaskTreeValue | null => {
                        // Tasks with no children are always treated as collapsed.
                        if (childTaskCount === 0) return null;

                        return {
                            childrenTree,
                            childrenParents: newParents,
                            // The query might not have loaded all child tasks. We'll need to render some
                            // unloaded task items if that's the case.
                            unloadedChildTaskCount: Math.max(
                                0,
                                childTaskCount - childrenTree.tasks.length,
                            ),
                        };
                    },
                );
            });
        });
    }).map(tasks => ({
        query,
        parents,
        tasks,
    }));
}

export type TaskGridViewVirtualizedListStateItem =
    | TaskGridViewVirtualizedListStateTaskItem
    | TaskGridViewVirtualizedListStateUnloadedChildTaskItem;

export type TaskGridViewVirtualizedListStateTaskItem = {
    readonly type: "Task";
    readonly parents: ReadonlyArray<{
        readonly query: TaskClientQuery;
        readonly cursor: TaskQuerySortCursor;
    }>;
    readonly query: TaskClientQuery;
    readonly cursor: TaskQuerySortCursor;
    readonly isFirstTaskInQuery: boolean;
};

export type TaskGridViewVirtualizedListStateUnloadedChildTaskItem = {
    readonly type: "UnloadedChildTask";
    readonly parents: ReadonlyArray<{
        readonly query: TaskClientQuery;
        readonly cursor: TaskQuerySortCursor;
    }>;
    readonly unloadedChildTaskIndex: number;
};

export type TaskGridViewVirtualizedListAnimation =
    | {
          readonly type: "Create";
          readonly startTime: number;
          readonly duration: number;
          readonly kind: "Task";
          readonly taskId: TaskId;
          readonly newItem: Omit<TaskGridViewVirtualizedListStateTaskItem, "isFirstTaskInQuery">;
          readonly newChildrenCount: number;
      }
    | {
          readonly type: "Delete";
          readonly startTime: number;
          readonly duration: number;
          readonly kind: "Task";
          readonly taskId: TaskId;
          readonly oldItem: Omit<TaskGridViewVirtualizedListStateTaskItem, "isFirstTaskInQuery">;
          readonly oldChildrenCount: number;
      }
    | {
          readonly type: "Move";
          readonly startTime: number;
          readonly duration: number;
          readonly kind: "Task";
          readonly taskId: TaskId;
          readonly newItem: Omit<TaskGridViewVirtualizedListStateTaskItem, "isFirstTaskInQuery">;
          readonly oldItem: Omit<TaskGridViewVirtualizedListStateTaskItem, "isFirstTaskInQuery">;
          readonly direction: "Up" | "Down";
      }
    | {
          readonly type: "Create";
          readonly startTime: number;
          readonly duration: number;
          readonly kind: "Unknown";
          readonly height: ParsableRemLength;
      }
    | {
          readonly type: "Delete";
          readonly startTime: number;
          readonly duration: number;
          readonly kind: "Unknown";
          readonly height: ParsableRemLength;
      };

// All animations must have `startTime` and `duration`.
assertAssignableTypes<
    TaskGridViewVirtualizedListAnimation,
    {startTime: number; duration: number}
>();

/**
 * Flat list of tasks in a grid view for rendering with a
 * `<VirtualizedScrollView>`. While tasks form a naturally nested structure, we
 * need to flatten them for virtualization.
 *
 * This class only contains the actual tasks in the grid view. Not the ghost tasks
 * or decorative tasks like `useTaskGridViewVirtualizedList()`.
 *
 * This class's implementation is derived from `VirtualizedTree`. It didn't make
 * sense to use `VirtualizedTree` itself because order was determined by
 * `OrderKey`s (and we want to use `TaskQuerySortCursor`) but we're using the same
 * subtree item count caching technique to make re-rendering after a change
 * O(log(n)) instead of O(n).
 */
export class TaskGridViewVirtualizedListState {
    private readonly _tree: TaskGridViewVirtualizedTaskTree | null;

    /**
     * Cache of the item count in `tree` subtrees.
     */
    private readonly _itemCountSubtreeCache: WeakMap<
        TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>,
        number
    >;

    private constructor(
        tree: TaskGridViewVirtualizedTaskTree | null,
        itemCountSubtreeCache: WeakMap<
            TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>,
            number
        >,
    ) {
        this._tree = tree;
        this._itemCountSubtreeCache = itemCountSubtreeCache;
    }

    public static new(
        query: TaskClientQuery | null,
        getAreChildTasksExpandedStore: (taskPath: ReadonlyArray<TaskId>) => Store<true | undefined>,
        maxGridExpandableTaskDepth: number,
    ): Store<TaskGridViewVirtualizedListState> {
        // Share the item count subtree cache across all virtualized lists that are
        // created.
        const itemCountSubtreeCache = new WeakMap<
            TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>,
            number
        >();

        if (!query) {
            return new ConstStore(
                new TaskGridViewVirtualizedListState(null, itemCountSubtreeCache),
            );
        }

        return createTaskGridViewVirtualizedTaskTree(
            query,
            getAreChildTasksExpandedStore,
            [],
            maxGridExpandableTaskDepth,
        ).map(tree => new TaskGridViewVirtualizedListState(tree, itemCountSubtreeCache));
    }

    /**
     * Get the number of items in the provided subtree.
     *
     * WARNING: If you want to get the count of all items before the node you are
     * looking at, do not use `_getSubtreeItemCount(iterator.node.left)`, instead use
     * `_getPreviousItemCount(iterator)`. The former does not count items in parent
     * nodes.
     *
     * This function is cached and takes advantage of the structural sharing in our
     * binary tree. When the tree is updated, some subtrees are left untouched so we
     * maintain the cached value for those subtrees. Running this function on a new
     * tree is O(n) but running this function on an updated tree is O(log(n)).
     */
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
                (node.value.childrenTree !== null
                    ? this._getSubtreeItemCount(node.value.childrenTree.tasks.root)
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
     * Get the item count of all entries before the node the iterator is looking at.
     */
    private _getPreviousItemCount(
        query: TaskClientQuery,
        iterator: TreeIterator<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>,
    ): number {
        if (!iterator.node) return 0;
        let itemCount = this._getSubtreeItemCount(iterator.node.left);
        const beforeOrderKey = iterator.node.key;

        for (let i = iterator._stack.length - 2; i >= 0; i--) {
            const parentNode = iterator._stack[i]!;

            if (compareTaskQuerySortCursors(query.sorts, parentNode.key, beforeOrderKey) < 0) {
                let valueItemCount: number;
                if (parentNode.value === null) {
                    valueItemCount = 1;
                } else {
                    valueItemCount =
                        1 +
                        (parentNode.value.childrenTree !== null
                            ? this._getSubtreeItemCount(parentNode.value.childrenTree.tasks.root)
                            : 0) +
                        parentNode.value.unloadedChildTaskCount;
                }

                itemCount += valueItemCount;
                itemCount += this._getSubtreeItemCount(parentNode.left);
            }
        }

        return itemCount;
    }

    /**
     * Return the root query if our state has one.
     */
    public getRootQueryIfExists() {
        return this._tree?.query ?? null;
    }

    /**
     * If the provided `TaskQuerySortCursor` exists in our state at the root level then
     * return the index corresponding to the task. Otherwise return null.
     */
    public getIndexByRootCursorIfExists(cursor: TaskQuerySortCursor): number | null {
        if (!this._tree) return null;
        const iterator = this._tree.tasks.find(cursor);
        if (!iterator?.valid) return null;
        return this._getPreviousItemCount(this._tree.query, iterator);
    }

    /**
     * If a task with the provided cursor within parents with the provided cursors
     * exists in our state then return the index corresponding to the task. Otherwise
     * return null.
     */
    public getIndexByCursorAndParentsIfExists({
        parents,
        cursor,
    }: {
        parents: ReadonlyArray<{
            query: TaskClientQuery;
            cursor: TaskQuerySortCursor;
        }>;
        cursor: TaskQuerySortCursor;
    }): number | null {
        let index = 0;
        let tree = this._tree;

        for (const parent of parents) {
            if (!tree) return null;

            // Safe guard so we don't end up comparing cursors from different queries (which
            // may cause assertion failures).
            if (tree.query !== parent.query) return null;

            const iterator = tree.tasks.find(parent.cursor);
            if (!iterator.value) return null;

            index += this._getPreviousItemCount(tree.query, iterator) + 1;
            tree = iterator.value.childrenTree;
        }

        if (!tree) return null;

        const iterator = tree.tasks.find(cursor);
        if (!iterator.valid) return null;

        index += this._getPreviousItemCount(tree.query, iterator);

        return index;
    }

    /**
     * The total number of items in our tree. Includes all expanded child tasks.
     */
    public getItemCount(): number {
        if (this._tree === null) return 0;
        return this._getSubtreeItemCount(this._tree.tasks.root);
    }

    private _iterator: {
        itemIndex: number;
        // We keep track of the last item in the iterator so calling `getItem(n)`
        // repeatedly is O(1).
        item: TaskGridViewVirtualizedListStateItem;
        iterator: Iterator<TaskGridViewVirtualizedListStateItem>;
    } | null = null;

    /**
     * Get the item at the specified index. If you try to access an item outside of
     * this list's bounds you'll get an error.
     *
     * When you first call this function we perform an O(log(n)) binary search to
     * determine the right item. Afterwards if you iterate forward one item at a time
     * (`getItem(n + 1)`) we internally hold an iterator so subsequent calls can be
     * O(1). Iterating backwards (`getItem(n - 1)`) is not optimized and will be
     * O(log(n)).
     */
    public getItem(itemIndex: number): TaskGridViewVirtualizedListStateItem {
        if (this._iterator) {
            if (itemIndex === this._iterator.itemIndex) {
                return this._iterator.item;
            }

            if (itemIndex === this._iterator.itemIndex + 1) {
                const result = this._iterator.iterator.next();
                if (result.done) throw new OutOfRangeError("Index out of bounds");

                this._iterator.itemIndex++;
                this._iterator.item = result.value;

                return result.value;
            }
        }

        const iterator = this._getItem(itemIndex);

        const result = iterator.next();
        if (result.done) throw new OutOfRangeError("Index out of bounds");

        this._iterator = {
            itemIndex,
            item: result.value,
            iterator,
        };

        return result.value;
    }

    private _getItem(itemIndex: number) {
        // A null tree is empty so throw since this is an out-of-bounds-read.
        assert(this._tree);

        const stack: Array<{
            tree: TaskGridViewVirtualizedTaskTree;
            firstKey: TaskQuerySortCursor;
            iterator: TreeIterator<
                TaskQuerySortCursor,
                TaskGridViewVirtualizedTaskTreeValue | null
            >;
            nextPhase: "Enter" | "ExitChildren";
        }> = [];

        // Binary search to find the item...
        const search = (
            index: number,
            tree: TaskGridViewVirtualizedTaskTree,
            node: TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null> | null,
            nodeStack: Array<
                TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>
            >,
        ): IterableIterator<TaskGridViewVirtualizedListStateItem> => {
            if (!node) throw new OutOfRangeError("Index out of bounds");
            nodeStack?.push(node);

            let valueItemCount: number;
            if (node.value === null) {
                valueItemCount = 1;
            } else {
                valueItemCount =
                    1 +
                    (node.value.childrenTree !== null
                        ? this._getSubtreeItemCount(node.value.childrenTree.tasks.root)
                        : 0) +
                    node.value.unloadedChildTaskCount;
            }

            const leftItemCount = this._getSubtreeItemCount(node.left);

            // If the index is not in our node then recurse into either the left or right
            // subtree.
            if (index < leftItemCount) {
                return search(index, tree, node.left, nodeStack);
            } else if (leftItemCount + valueItemCount <= index) {
                return search(
                    index - (leftItemCount + valueItemCount),
                    tree,
                    node.right,
                    nodeStack,
                );
            } else {
                assert(leftItemCount <= index && index < leftItemCount + valueItemCount);

                if (leftItemCount === index) {
                    stack.push({
                        tree,
                        firstKey: tree.tasks.begin.key!,
                        iterator: new unsafe_TreeIterator(tree.tasks, nodeStack),
                        nextPhase: "Enter",
                    });

                    return iterateTaskGridViewVirtualizedListStateItems(stack, null);
                }

                // `null` values have only 1 item and it's the task item.
                assert(node.value !== null);

                const childrenItemCount =
                    node.value.childrenTree !== null
                        ? this._getSubtreeItemCount(node.value.childrenTree.tasks.root)
                        : 0;

                const childTaskIndex = index - leftItemCount - 1;
                assert(0 <= childTaskIndex);

                if (childTaskIndex >= childrenItemCount) {
                    stack.push({
                        tree,
                        firstKey: tree.tasks.begin.key!,
                        iterator: new unsafe_TreeIterator(tree.tasks, nodeStack),
                        nextPhase: "ExitChildren",
                    });

                    return iterateTaskGridViewVirtualizedListStateItems(
                        stack,
                        childTaskIndex - childrenItemCount,
                    );
                } else {
                    stack.push({
                        tree,
                        firstKey: tree.tasks.begin.key!,
                        iterator: new unsafe_TreeIterator(tree.tasks, nodeStack),
                        nextPhase: "ExitChildren",
                    });

                    return search(
                        index - leftItemCount - 1,
                        node.value.childrenTree!,
                        node.value.childrenTree!.tasks.root,
                        [],
                    );
                }
            }
        };

        return assertExists(search(itemIndex, this._tree, this._tree.tasks.root, []));
    }

    /**
     * Get animations to transition us from our old state to our new state.
     */
    public getAnimations(
        previousState: TaskGridViewVirtualizedListState,
    ): Set<TaskGridViewVirtualizedListAnimation & {kind: "Task"}> {
        const startTime = Date.now();

        const animations = new Set<TaskGridViewVirtualizedListAnimation & {kind: "Task"}>();

        const animationsByTaskId = new Map<
            TaskId,
            Set<TaskGridViewVirtualizedListAnimation & {kind: "Task"}>
        >();

        const getAnimations = (
            oldTree: TaskGridViewVirtualizedTaskTree | null,
            newTree: TaskGridViewVirtualizedTaskTree | null,
            oldUnloadedChildTaskCount: number,
            newUnloadedChildTaskCount: number,
        ) => {
            if (!oldTree) {
                newTree?.tasks.forEach((key, value) => {
                    const newChildrenCount = this._getSubtreeItemCount(
                        value?.childrenTree?.tasks.root ?? null,
                    );

                    const animation: TaskGridViewVirtualizedListAnimation = {
                        type: "Create",
                        startTime,
                        // If a task has some children, allow the animation to take a little longer but not
                        // too long.
                        duration: taskAnimationDurationMs * (1 + Math.min(newChildrenCount, 1)),
                        kind: "Task",
                        taskId: getTaskQuerySortCursorTaskId(key),
                        newItem: {
                            type: "Task",
                            query: newTree.query,
                            parents: newTree.parents,
                            cursor: key,
                        },
                        newChildrenCount,
                    };

                    animations.add(animation);

                    getOrSetDefaultMapValue(
                        animationsByTaskId,
                        getTaskQuerySortCursorTaskId(key),
                        () => new Set(),
                    ).add(animation);
                });
                return;
            }

            if (!newTree) {
                oldTree?.tasks.forEach((key, value) => {
                    const oldChildrenCount = this._getSubtreeItemCount(
                        value?.childrenTree?.tasks.root ?? null,
                    );

                    const animation: TaskGridViewVirtualizedListAnimation = {
                        type: "Delete",
                        startTime,
                        // If a task has some children, allow the animation to take a little longer but not
                        // too long.
                        duration: taskAnimationDurationMs * (1 + Math.min(oldChildrenCount, 1)),
                        kind: "Task",
                        taskId: getTaskQuerySortCursorTaskId(key),
                        oldItem: {
                            type: "Task",
                            query: oldTree.query,
                            parents: oldTree.parents,
                            cursor: key,
                        },
                        oldChildrenCount,
                    };

                    animations.add(animation);

                    getOrSetDefaultMapValue(
                        animationsByTaskId,
                        getTaskQuerySortCursorTaskId(key),
                        () => new Set(),
                    ).add(animation);
                });
                return;
            }

            if (oldTree.parents !== newTree.parents) return;
            if (oldTree.query !== newTree.query) return;

            const changes = symmetricDiffTree(oldTree.tasks, newTree.tasks);

            let remainingUnloadedChildTaskCount =
                oldUnloadedChildTaskCount - newUnloadedChildTaskCount;

            for (const change of changes) {
                switch (change.type) {
                    case "CreateEntry": {
                        // If a task was created to replace an unloaded child task then we don't want to
                        // animate that task when it appears. This prevents an animation when you expand a
                        // task in grid view and the tasks within are unloaded.
                        const oldLastCursor = oldTree.tasks.end.key;
                        if (
                            (!oldLastCursor ||
                                compareTaskQuerySortCursors(
                                    oldTree.query.sorts,
                                    oldLastCursor,
                                    change.key,
                                ) < 0) &&
                            remainingUnloadedChildTaskCount > 0
                        ) {
                            remainingUnloadedChildTaskCount--;
                            break;
                        }

                        const newChildrenCount = this._getSubtreeItemCount(
                            change.newValue?.childrenTree?.tasks.root ?? null,
                        );

                        const animation: TaskGridViewVirtualizedListAnimation = {
                            type: "Create",
                            startTime,
                            // If a task has some children, allow the animation to take a little longer but not
                            // too long.
                            duration: taskAnimationDurationMs * (1 + Math.min(newChildrenCount, 1)),
                            kind: "Task",
                            taskId: getTaskQuerySortCursorTaskId(change.key),
                            newItem: {
                                type: "Task",
                                query: newTree.query,
                                parents: newTree.parents,
                                cursor: change.key,
                            },
                            newChildrenCount,
                        };

                        animations.add(animation);

                        getOrSetDefaultMapValue(
                            animationsByTaskId,
                            getTaskQuerySortCursorTaskId(change.key),
                            () => new Set(),
                        ).add(animation);
                        break;
                    }
                    case "DeleteEntry": {
                        const oldChildrenCount = this._getSubtreeItemCount(
                            change.oldValue?.childrenTree?.tasks.root ?? null,
                        );

                        const animation: TaskGridViewVirtualizedListAnimation = {
                            type: "Delete",
                            startTime,
                            // If a task has some children, allow the animation to take a little longer but not
                            // too long.
                            duration: taskAnimationDurationMs * (1 + Math.min(oldChildrenCount, 1)),
                            kind: "Task",
                            taskId: getTaskQuerySortCursorTaskId(change.key),
                            oldItem: {
                                type: "Task",
                                query: oldTree.query,
                                parents: oldTree.parents,
                                cursor: change.key,
                            },
                            oldChildrenCount,
                        };

                        animations.add(animation);

                        getOrSetDefaultMapValue(
                            animationsByTaskId,
                            getTaskQuerySortCursorTaskId(change.key),
                            () => new Set(),
                        ).add(animation);
                        break;
                    }
                    case "UpdateEntry": {
                        getAnimations(
                            change.oldValue?.childrenTree ?? null,
                            change.newValue?.childrenTree ?? null,
                            change.oldValue?.unloadedChildTaskCount ?? 0,
                            change.newValue?.unloadedChildTaskCount ?? 0,
                        );
                        break;
                    }
                    default:
                        throw exhaustive(change);
                }
            }
        };

        // If our root tree is transitioning to null or away from null then don't animate
        // all children.
        if (previousState._tree && this._tree) {
            getAnimations(previousState._tree, this._tree, 0, 0);
        }

        // If a task was both deleted and recreated then collapse that into one move
        // animation.
        for (const taskAnimations of animationsByTaskId.values()) {
            if (taskAnimations.size !== 2) continue;

            const taskAnimationsArray = Array.from(taskAnimations);
            const animation1 = taskAnimationsArray[0]!;
            const animation2 = taskAnimationsArray[1]!;

            if (animation1.type === "Create" && animation2.type === "Delete") {
                animations.delete(animation1);
                animations.delete(animation2);

                animations.add({
                    type: "Move",
                    startTime,
                    duration: taskAnimationDurationMs,
                    kind: "Task",
                    taskId: getTaskQuerySortCursorTaskId(animation1.newItem.cursor),
                    newItem: animation1.newItem,
                    oldItem: animation2.oldItem,
                    direction: isTaskGridViewVirtualizedListStateItemAfter(
                        animation2.oldItem,
                        animation1.newItem,
                    )
                        ? "Down"
                        : "Up",
                });
            }

            if (animation1.type === "Delete" && animation2.type === "Create") {
                animations.delete(animation1);
                animations.delete(animation2);

                animations.add({
                    type: "Move",
                    startTime,
                    duration: taskAnimationDurationMs,
                    kind: "Task",
                    taskId: getTaskQuerySortCursorTaskId(animation2.newItem.cursor),
                    newItem: animation2.newItem,
                    oldItem: animation1.oldItem,
                    direction: isTaskGridViewVirtualizedListStateItemAfter(
                        animation1.oldItem,
                        animation2.newItem,
                    )
                        ? "Down"
                        : "Up",
                });
            }
        }

        return animations;
    }
}

/**
 * Iterates forward through a `TaskGridViewVirtualizedTaskTree` starting anywhere
 * in the tree.
 *
 * If a node has children then the node will be visited twice. Once with the
 * `Enter` phase and once after iterating through all its children with the
 * `ExitChildren` phase.
 */
function* iterateTaskGridViewVirtualizedTaskTreeNodes(
    stack: Array<{
        tree: TaskGridViewVirtualizedTaskTree;
        firstKey: TaskQuerySortCursor;
        iterator: TreeIterator<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>;
        nextPhase: "Enter" | "ExitChildren";
    }>,
): IterableIterator<{
    tree: TaskGridViewVirtualizedTaskTree;
    firstKey: TaskQuerySortCursor;
    node: TreeNode<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>;
    phase: "Enter" | "ExitChildren";
}> {
    while (stack.length > 0) {
        const stackEntry = stack.pop()!;
        const {tree, firstKey, iterator} = stackEntry;

        while (iterator.valid) {
            const node = iterator.node!;

            if (stackEntry.nextPhase === "ExitChildren") {
                if (node.value) {
                    yield {
                        tree,
                        firstKey,
                        node,
                        phase: "ExitChildren",
                    };
                }

                stackEntry.nextPhase = "Enter";
                iterator.next();
                continue;
            }

            yield {
                tree,
                firstKey,
                node,
                phase: "Enter",
            };

            // If we don't have any loaded or unloaded children we don't need to yield an
            // `ExitChildren` phase for this node.
            if (!node.value) {
                iterator.next();
            } else {
                const childrenTree = node.value.childrenTree;

                stack.push({
                    tree,
                    firstKey,
                    iterator,
                    nextPhase: "ExitChildren",
                });

                if (childrenTree) {
                    const childrenIterator = childrenTree.tasks.begin;

                    if (childrenIterator.valid) {
                        stack.push({
                            tree: childrenTree,
                            firstKey: childrenIterator.key!,
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
 * Iterates through a `TaskGridViewVirtualizedTaskTree` starting anywhere in the
 * tree and emitting `TaskGridViewVirtualizedTaskListItem`s.
 *
 * If we start with a `UnloadedChildTask` then you should provide
 * `initialUnloadedChildTaskIndex`. It requires the tree node iterator to start
 * with the `ExitChildren` phase.
 */
function* iterateTaskGridViewVirtualizedListStateItems(
    stack: Array<{
        tree: TaskGridViewVirtualizedTaskTree;
        firstKey: TaskQuerySortCursor;
        iterator: TreeIterator<TaskQuerySortCursor, TaskGridViewVirtualizedTaskTreeValue | null>;
        nextPhase: "Enter" | "ExitChildren";
    }>,
    initialUnloadedChildTaskIndex: number | null,
): IterableIterator<TaskGridViewVirtualizedListStateItem> {
    const iterator = iterateTaskGridViewVirtualizedTaskTreeNodes(stack);

    // Handle starting in the middle of some unloaded child task section:
    if (initialUnloadedChildTaskIndex !== null) {
        const result = iterator.next();
        if (result.done) return;

        const {node, phase} = result.value;

        assert(phase !== "Enter");
        assert(node.value && node.value.unloadedChildTaskCount > 0);

        for (let i = initialUnloadedChildTaskIndex; i < node.value.unloadedChildTaskCount; i++) {
            yield {
                type: "UnloadedChildTask",
                parents: node.value.childrenParents,
                unloadedChildTaskIndex: i,
            };
        }

        initialUnloadedChildTaskIndex = null;
    }

    // Loop through our tree yielding `UnloadedChildTask`s when we exit a node when
    // appropriate.
    for (const {tree, firstKey, node, phase} of iterator) {
        if (phase === "Enter") {
            yield {
                type: "Task",
                parents: tree.parents,
                query: tree.query,
                cursor: node.key,
                isFirstTaskInQuery: firstKey === node.key,
            };
        } else if (node.value && node.value.unloadedChildTaskCount > 0) {
            for (let i = 0; i < node.value.unloadedChildTaskCount; i++) {
                yield {
                    type: "UnloadedChildTask",
                    parents: node.value.childrenParents,
                    unloadedChildTaskIndex: i,
                };
            }
        }
    }
}

/**
 * Returns true if `targetItem` comes after `afterItem`.
 *
 * Returns null if we can't tell whether `targetItem` comes after `afterItem`
 * because some query sorts changed.
 */
export function isTaskGridViewVirtualizedListStateItemAfter(
    afterItem: Omit<TaskGridViewVirtualizedListStateTaskItem, "isFirstTaskInQuery">,
    targetItem: DistributiveOmit<TaskGridViewVirtualizedListStateItem, "isFirstTaskInQuery">,
): boolean | null {
    let isEqual = true;

    for (let i = 0; i <= targetItem.parents.length; i++) {
        let targetQuery;
        let targetCursor;

        if (i === targetItem.parents.length) {
            // All preceding parents were after. Unloaded child tasks are always after any
            // tasks sharing the same parents.
            if (targetItem.type === "UnloadedChildTask") {
                return true;
            }

            targetQuery = targetItem.query;
            targetCursor = targetItem.cursor;
        } else {
            const targetParent = targetItem.parents[i]!;
            targetQuery = targetParent.query;
            targetCursor = targetParent.cursor;
        }

        // All preceding parents were after. If our target item has more indentation then
        // the after item it's always considered after.
        if (i > afterItem.parents.length) {
            return true;
        }

        let afterQuery;
        let afterCursor;

        if (i === afterItem.parents.length) {
            afterQuery = afterItem.query;
            afterCursor = afterItem.cursor;
        } else {
            const afterParent = afterItem.parents[i]!;
            afterQuery = afterParent.query;
            afterCursor = afterParent.cursor;
        }

        // If the sorts change (we don't expect this to happen) we can't compare cursors.
        // Return null since we can't accurately answer.
        if (!isDeepEqual(targetQuery.sorts, afterQuery.sorts)) return null;

        const comparison = compareTaskQuerySortCursors(
            targetQuery.sorts,
            targetCursor,
            afterCursor,
        );

        isEqual &&= comparison === 0;

        if (comparison < 0) {
            return false;
        }
    }

    // We handle two cases here:
    //
    // - [1]
    // - [2]
    //     - [2, 1]
    // - [3]
    //
    // Here [2] should be considered before [2, 1] and [3] should be considered after
    // [2, 1]. Both reach this branch so return false if parent cursors have all been
    // equal. [1] already returned false because 1 is less than 2.
    return !isEqual;
}
