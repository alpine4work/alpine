/**
 * A [linked list][1] is an inefficient immutable list representation. It has
 * O(1) inserts but that's about all its good for.
 *
 * Prefer `ReadonlyArray<Item>` in most cases. Eventually we may add an
 * `ImmutableList<Item>` implementation using something like [RRB-Trees][2].
 *
 * [1]: https://en.wikipedia.org/wiki/Linked_list
 * [2]: https://infoscience.epfl.ch/record/169879?ln=en
 */
export type LinkedList<Item> = NonEmptyLinkedList<Item> | null;

/**
 * A linked list that is not empty.
 */
export type NonEmptyLinkedList<Item> = {
    readonly value: Item;
    readonly next: LinkedList<Item>;
};
