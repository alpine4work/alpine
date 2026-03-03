/**
 * A [linked list][1] is an inefficient immutable list representation. It has O(1)
 * inserts but that's about all its good for.
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

/**
 * Reverse a linked list. Same as `Array.reverse()` but for linked lists.
 */
export function reverseLinkedList<Item>(list: LinkedList<Item>): LinkedList<Item> {
    let newList: LinkedList<Item> = null;

    while (list !== null) {
        newList = {value: list.value, next: newList};
        list = list.next;
    }

    return newList;
}

/**
 * Iterate through each item in a linked list. Same as `Array.forEach()` but for
 * linked lists.
 */
export function forEachLinkedList<Item>(
    list: LinkedList<Item>,
    forEach: (item: Item, index: number) => void,
) {
    let index = 0;

    while (list !== null) {
        forEach(list.value, index);
        list = list.next;
        index++;
    }
}

/**
 * Reduces a linked list into a single value. Same as `Array.reduce()` but for
 * linked lists.
 */
export function reduceLinkedList<Item, Value>(
    list: LinkedList<Item>,
    reduce: (value: Value, item: Item, index: number) => Value,
    initialValue: Value,
): Value {
    let index = 0;
    let value = initialValue;

    while (list !== null) {
        value = reduce(value, list.value, index);
        list = list.next;
        index++;
    }

    return value;
}
