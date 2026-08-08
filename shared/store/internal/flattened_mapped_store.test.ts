import createTree from "functional-red-black-tree";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {Store} from "~/shared/store/store.js";
import {flatMapTreeStoreValues} from "~/shared/store/tree_store.js";
import {ValueStore} from "~/shared/store/value_store.js";

test("weak immediate listeners are garbage collected", async () => {
    const store1 = new ValueStore(true);

    expect(store1._getWeakImmediateListenerCountForTest()).toEqual(0);

    const store2 = new ValueStore(1);
    const store3 = new ValueStore(2);

    expect(store1._getWeakImmediateListenerCountForTest()).toEqual(0);

    const store4 = store1.flatMap(condition => (condition ? store2 : store3));

    expect(store1._getWeakImmediateListenerCountForTest()).toEqual(0);

    const store5 = flatMapTreeStoreValues(
        new ValueStore(
            createTree<number, Store<number>>().insert(
                1,
                store1.flatMap(condition => (condition ? store2 : store3)),
            ),
        ),
        cast,
    );

    store5.getSnapshot();

    expect(store1._getWeakImmediateListenerCountForTest()).toEqual(1);

    flatMapTreeStoreValues(
        new ValueStore(
            createTree<number, Store<number>>().insert(
                1,
                store1.flatMap(condition => (condition ? store3 : store2)),
            ),
        ),
        cast,
    ).getSnapshot();

    expect(store1._getWeakImmediateListenerCountForTest()).toEqual(2);

    await waitMacrotask();
    (globalThis as any).gc!();

    expect(store1._getWeakImmediateListenerCountForTest()).toEqual(1);

    // Make sure `store4` and `store5` are not garbage collected.
    store4.getSnapshot();
    store5.getSnapshot();
});
