import createTree, {Tree} from "functional-red-black-tree";
import {FlattenedMappedTreeStore} from "~/shared/store/internal/flattened_mapped_tree_store.js";
import {ValueStore} from "~/shared/store/value_store.js";

function intoMap<Key, Value>(tree: Tree<Key, Value>): Map<Key, Value> {
    const map = new Map<Key, Value>();

    const iterator = tree.begin;
    while (iterator.valid) {
        map.set(iterator.key!, iterator.value!);
        iterator.next();
    }

    return map;
}

test("correctly updates snapshot when dependencies change with no listeners", () => {
    const valueAStore = new ValueStore(1);
    const valueBStore = new ValueStore(2);
    const valueCStore = new ValueStore(3);
    const valueDStore = new ValueStore(4);

    const store1 = new ValueStore(
        createTree<string, ValueStore<number>>().insert("a", valueAStore).insert("b", valueBStore),
    );

    const store2 = new FlattenedMappedTreeStore<string, ValueStore<number>, number>(
        store1,
        store => store,
    );

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
        ]),
    );

    store1.set(tree => tree.insert("c", valueCStore));

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
        ]),
    );

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
        ]),
    );

    store1.set(tree => tree.insert("d", valueDStore));

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
            ["d", 4],
        ]),
    );

    valueDStore.set(5);

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
            ["d", 5],
        ]),
    );

    valueBStore.set(2.5);

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2.5],
            ["c", 3],
            ["d", 5],
        ]),
    );
});

test("correctly calls listener registered multiple times and updates snapshot when dependencies change (scenario 1)", () => {
    const valueAStore = new ValueStore(1);
    const valueBStore = new ValueStore(2);
    const valueCStore = new ValueStore(3);
    const valueDStore = new ValueStore(4);

    const store1 = new ValueStore(
        createTree<string, ValueStore<number>>().insert("a", valueAStore).insert("b", valueBStore),
    );

    const store2 = new FlattenedMappedTreeStore<string, ValueStore<number>, number>(
        store1,
        store => store,
    );

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
        ]),
    );

    store1.set(tree => tree.insert("c", valueCStore));

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
        ]),
    );

    let expectedSnapshot: Map<string, number> = new Map();

    let listenerCallCount = 0;

    const errors: Array<unknown> = [];

    const listener = () => {
        try {
            listenerCallCount++;
            expect(intoMap(store2.getSnapshot())).toEqual(expectedSnapshot);
        } catch (error) {
            errors.push(error);
            throw error;
        }
    };

    valueBStore.addListener(listener);
    store2.addListener(listener);

    expect(listenerCallCount).toEqual(0);

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
        ]),
    );

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
        ["d", 4],
    ]);

    store1.set(tree => tree.insert("d", valueDStore));

    expect(listenerCallCount).toEqual(1);

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
        ["d", 5],
    ]);

    valueDStore.set(5);

    expect(listenerCallCount).toEqual(2);

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2.5],
        ["c", 3],
        ["d", 5],
    ]);

    valueBStore.set(2.5);

    expect(listenerCallCount).toEqual(3);

    // Listener errors are treated as uncaught errors so rethrow them here.
    if (errors.length > 0) {
        throw errors[0];
    }
});

test("correctly calls listener registered multiple times and updates snapshot when dependencies change (scenario 2)", () => {
    const valueAStore = new ValueStore(1);
    const valueBStore = new ValueStore(2);
    const valueCStore = new ValueStore(3);
    const valueDStore = new ValueStore(4);

    const store1 = new ValueStore(
        createTree<string, ValueStore<number>>().insert("a", valueAStore).insert("b", valueBStore),
    );

    const store2 = new FlattenedMappedTreeStore<string, ValueStore<number>, number>(
        store1,
        store => store,
    );

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
        ]),
    );

    store1.set(tree => tree.insert("c", valueCStore));

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
        ]),
    );

    let expectedSnapshot: Map<string, number> = new Map();

    let listenerCallCount = 0;

    const errors: Array<unknown> = [];

    const listener = () => {
        try {
            listenerCallCount++;
            expect(intoMap(store2.getSnapshot())).toEqual(expectedSnapshot);
        } catch (error) {
            errors.push(error);
            throw error;
        }
    };

    store2.addListener(listener);
    valueBStore.addListener(listener);

    expect(listenerCallCount).toEqual(0);

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
        ]),
    );

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
        ["d", 4],
    ]);

    store1.set(tree => tree.insert("d", valueDStore));

    expect(listenerCallCount).toEqual(1);

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
        ["d", 5],
    ]);

    valueDStore.set(5);

    expect(listenerCallCount).toEqual(2);

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2.5],
        ["c", 3],
        ["d", 5],
    ]);

    valueBStore.set(2.5);

    expect(listenerCallCount).toEqual(3);

    // Listener errors are treated as uncaught errors so rethrow them here.
    if (errors.length > 0) {
        throw errors[0];
    }
});

test("correctly calls listener registered multiple times and updates snapshot when dependencies change (scenario 3)", () => {
    const valueAStore = new ValueStore(1);
    const valueBStore = new ValueStore(2);
    const valueCStore = new ValueStore(3);
    const valueDStore = new ValueStore(4);

    const store1 = new ValueStore(
        createTree<string, ValueStore<number>>().insert("a", valueAStore).insert("b", valueBStore),
    );

    const store2 = new FlattenedMappedTreeStore<string, ValueStore<number>, number>(
        store1,
        store => store,
    );

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
        ]),
    );

    store1.set(tree => tree.insert("c", valueCStore));

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
        ]),
    );

    let expectedSnapshot: Map<string, number> = new Map();

    let listenerCallCount = 0;

    const errors: Array<unknown> = [];

    const listener = () => {
        try {
            listenerCallCount++;
            expect(intoMap(store2.getSnapshot())).toEqual(expectedSnapshot);
        } catch (error) {
            errors.push(error);
            throw error;
        }
    };

    store1.addListener(listener);
    store2.addListener(listener);

    expect(listenerCallCount).toEqual(0);

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
        ]),
    );

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
        ["d", 4],
    ]);

    store1.set(tree => tree.insert("d", valueDStore));

    expect(listenerCallCount).toEqual(1);

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
        ["d", 5],
    ]);

    valueDStore.set(5);

    expect(listenerCallCount).toEqual(2);

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2.5],
        ["c", 3],
        ["d", 5],
    ]);

    valueBStore.set(2.5);

    expect(listenerCallCount).toEqual(3);

    // Listener errors are treated as uncaught errors so rethrow them here.
    if (errors.length > 0) {
        throw errors[0];
    }
});

test("correctly calls listener registered multiple times and updates snapshot when dependencies change (scenario 4)", () => {
    const valueAStore = new ValueStore(1);
    const valueBStore = new ValueStore(2);
    const valueCStore = new ValueStore(3);
    const valueDStore = new ValueStore(4);

    const store1 = new ValueStore(
        createTree<string, ValueStore<number>>().insert("a", valueAStore).insert("b", valueBStore),
    );

    const store2 = new FlattenedMappedTreeStore<string, ValueStore<number>, number>(
        store1,
        store => store,
    );

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
        ]),
    );

    store1.set(tree => tree.insert("c", valueCStore));

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
        ]),
    );

    let expectedSnapshot: Map<string, number> = new Map();

    let listenerCallCount = 0;

    const errors: Array<unknown> = [];

    const listener = () => {
        try {
            listenerCallCount++;
            expect(intoMap(store2.getSnapshot())).toEqual(expectedSnapshot);
        } catch (error) {
            errors.push(error);
            throw error;
        }
    };

    store2.addListener(listener);
    store1.addListener(listener);

    expect(listenerCallCount).toEqual(0);

    expect(intoMap(store2.getSnapshot())).toEqual(
        new Map([
            ["a", 1],
            ["b", 2],
            ["c", 3],
        ]),
    );

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
        ["d", 4],
    ]);

    store1.set(tree => tree.insert("d", valueDStore));

    expect(listenerCallCount).toEqual(1);

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
        ["d", 5],
    ]);

    valueDStore.set(5);

    expect(listenerCallCount).toEqual(2);

    expectedSnapshot = new Map([
        ["a", 1],
        ["b", 2.5],
        ["c", 3],
        ["d", 5],
    ]);

    valueBStore.set(2.5);

    expect(listenerCallCount).toEqual(3);

    // Listener errors are treated as uncaught errors so rethrow them here.
    if (errors.length > 0) {
        throw errors[0];
    }
});
