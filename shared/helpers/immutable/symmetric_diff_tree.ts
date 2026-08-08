/**
 * NOTE(calebmer, 2023-05-03): This is a TypeScript port of the
 * [`Map.symmetric_diff`][1] function ([source][2]) from Jane Street's Base project
 * which is their custom standard library for OCaml.
 *
 * I ported the Jane Street `Map.symmetric_diff` function because it is designed to
 * have good performance when the two maps have a lot of structural sharing.
 *
 * The immutable map implementation we use in our codebase is the
 * [`functional-red-black-tree`][3] package. So this port is written to work with
 * that.
 *
 * As I write this comment, I have not tested this with a `Tree` that has multiple
 * values for the same key. Prefer using this function with trees that have one
 * value per key.
 *
 * OCaml is a hard language to read if you're not familiar with it. I've tried to
 * generally stay close to the OCaml implementation with a couple differences:
 *
 * - Expand acronyms in names to full words (same with single letter variables).
 * - Unrolled code that uses tail-call optimization into while loops. While
 *   tail-call optimization is in the ES6 specification it is [only implemented in
 *   Safari][4]. Tail-call optimization is essential for functional code like this
 *   to perform well which is why I chose to manually unroll into while loops. (The
 *   transformation from recursive code with a tail-call to a while loop is fairly
 *   straightforward.)
 *
 * [1]:
 *     https://ocaml.janestreet.com/ocaml-core/v0.12/doc/base/Base/Map/index.html#val-symmetric_diff
 * [2]:
 *     https://github.com/janestreet/base/blob/a2b9340b5b2bf8df935422d14e03e497e6e8c98f/src/map.ml#L1189-L1212
 * [3]: https://www.npmjs.com/package/functional-red-black-tree
 * [4]:
 *     https://kangax.github.io/compat-table/es6/#test-proper_tail_calls_(tail_call_optimisation)
 *
 * The MIT License
 *
 * Copyright (c) 2008--2023 Jane Street Group, LLC
 * <opensource-contacts@janestreet.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import {Tree, Node as TreeNode} from "functional-red-black-tree";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export type TreeChange<Key, Value> =
    | {
          readonly type: "CreateEntry";
          readonly key: Key;
          readonly newValue: Value;
      }
    | {
          readonly type: "DeleteEntry";
          readonly key: Key;
          readonly oldValue: Value;
      }
    | {
          readonly type: "UpdateEntry";
          readonly key: Key;
          readonly newValue: Value;
          readonly oldValue: Value;
      };

/**
 * Returns a list of changes between `oldTree` and `newTree`. It is intended to be
 * efficient in the case where `oldTree` and `newTree` share a large amount of
 * structure. The keys in the output array will be in sorted order.
 */
// Derived from the `symmetric_diff` function.
// https://github.com/janestreet/base/blob/a2b9340b5b2bf8df935422d14e03e497e6e8c98f/src/map.ml#L1189-L1212
export function symmetricDiffTree<Key, Value>(
    oldTree: Tree<Key, Value>,
    newTree: Tree<Key, Value>,
): Array<TreeChange<Key, Value>> {
    assert(oldTree._compare === newTree._compare);

    const changes: Array<TreeChange<Key, Value>> = [];

    let state = dropPhysicallyEqualPrefix(oldTree.root, null, newTree.root, null);

    while (true) {
        const [state1, state2] = state;

        if (state1 === null) {
            if (state2 === null) {
                break;
            } else {
                changes.push({
                    type: "CreateEntry",
                    key: state2.key,
                    newValue: state2.value,
                });

                state = [null, cons(state2.tree, state2.next)];
            }
        } else {
            if (state2 === null) {
                changes.push({
                    type: "DeleteEntry",
                    key: state1.key,
                    oldValue: state1.value,
                });

                state = [cons(state1.tree, state1.next), null];
            } else {
                const comparison = oldTree._compare(state1.key, state2.key);

                if (comparison === 0) {
                    state = dropPhysicallyEqualPrefix(
                        state1.tree,
                        state1.next,
                        state2.tree,
                        state2.next,
                    );

                    if (!Object.is(state1.value, state2.value)) {
                        changes.push({
                            type: "UpdateEntry",
                            key: state1.key,
                            oldValue: state1.value,
                            newValue: state2.value,
                        });
                    }
                } else if (comparison < 0) {
                    changes.push({
                        type: "DeleteEntry",
                        key: state1.key,
                        oldValue: state1.value,
                    });

                    state = [cons(state1.tree, state1.next), state2];
                } else {
                    changes.push({
                        type: "CreateEntry",
                        key: state2.key,
                        newValue: state2.value,
                    });

                    state = [state1, cons(state2.tree, state2.next)];
                }
            }
        }
    }

    return changes;
}

// This is the `Enum.t` type here. The `End` variant is represented as `null` to
// reduce object allocations.
//
// There may be a more efficient way to represent this in JavaScript with an array.
// It's unclear to me whether an immutable linked list is essential here.
//
// https://github.com/janestreet/base/blob/a2b9340b5b2bf8df935422d14e03e497e6e8c98f/src/map.ml#L1042-L1044
type Enum<Key, Value> = {
    readonly key: Key;
    readonly value: Value;
    readonly tree: TreeNode<Key, Value> | null;
    readonly next: Enum<Key, Value> | null;
};

// Derived from the `cons` function.
//
// Its recursive tail-call is manually unrolled into a while loop since JavaScript
// engines don't consistently optimize tail calls.
//
// https://github.com/janestreet/base/blob/a2b9340b5b2bf8df935422d14e03e497e6e8c98f/src/map.ml#L1046-L1051
function cons<Key, Value>(
    tree: TreeNode<Key, Value> | null,
    state: Enum<Key, Value> | null,
): Enum<Key, Value> | null {
    while (true) {
        if (tree === null) {
            return state;
        } else if (tree.left === null && tree.right === null) {
            return {key: tree.key, value: tree.value, tree: null, next: state};
        } else {
            state = {key: tree.key, value: tree.value, tree: tree.right, next: state};
            tree = tree.left;
        }
    }
}

/**
 * Drops the largest physically-equal prefix of `tree1` and `tree2` that they
 * share, and then prepends the remaining data into `acc1` and `acc2`,
 * respectively. This can be asymptotically faster than `cons()` even if it skips a
 * small proportion of the tree because `cons()` is always O(log(n)) in the size of
 * the tree, while this function is O(log(n/m)) where m is the size of the part of
 * the tree that is skipped.
 */
// Derived from the `drop_phys_equal_prefix` function.
//
// Its recursive tail-calls are manually unrolled into a while loop since
// JavaScript engines don't consistently optimize tail calls.
//
// https://github.com/janestreet/base/blob/a2b9340b5b2bf8df935422d14e03e497e6e8c98f/src/map.ml#L1092C55-L1117
function dropPhysicallyEqualPrefix<Key, Value>(
    tree1: TreeNode<Key, Value> | null,
    acc1: Enum<Key, Value> | null,
    tree2: TreeNode<Key, Value> | null,
    acc2: Enum<Key, Value> | null,
): [Enum<Key, Value> | null, Enum<Key, Value> | null] {
    while (true) {
        if (tree1 === tree2) return [acc1, acc2];

        // NOTE(calebmer): The OCaml code at this point uses the height of the tree. We do
        // not have the height of the tree at this point. So instead we'll use the max
        // height of a red-black tree and hope it's not important! :)
        //
        // https://stackoverflow.com/questions/70944386/maximum-height-of-a-node-in-a-red-black-tree
        const maxHeight1 = Math.floor(2 * Math.log2((tree1?._count ?? 0) + 1));
        const maxHeight2 = Math.floor(2 * Math.log2((tree2?._count ?? 0) + 1));

        if (maxHeight1 === maxHeight2) {
            [tree1, acc1] = stepDeeperOrThrow(tree1, acc1);
            [tree2, acc2] = stepDeeperOrThrow(tree2, acc2);
        } else if (maxHeight2 > maxHeight1) {
            [tree2, acc2] = stepDeeperOrThrow(tree2, acc2);
        } else {
            [tree1, acc1] = stepDeeperOrThrow(tree1, acc1);
        }
    }
}

// Derived from the `step_deeper_exn` function.
// https://github.com/janestreet/base/blob/a2b9340b5b2bf8df935422d14e03e497e6e8c98f/src/map.ml#L1085C9-L1090
function stepDeeperOrThrow<Key, Value>(
    tree: TreeNode<Key, Value> | null,
    acc: Enum<Key, Value> | null,
): [TreeNode<Key, Value> | null, Enum<Key, Value> | null] {
    assert(tree);

    if (tree.left === null && tree.right === null) {
        return [null, {key: tree.key, value: tree.value, tree: null, next: acc}];
    } else {
        return [tree.left, {key: tree.key, value: tree.value, tree: tree.right, next: acc}];
    }
}
