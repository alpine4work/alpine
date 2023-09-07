import {ValueStore} from "~/client/helpers/store/value_store.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";

test("weak immediate listeners are garbage collected", async () => {
    const store1 = new ValueStore(true);

    expect(store1._getWeakImmediateListenerCountForTest()).toEqual(0);

    const store2 = new ValueStore(1);
    const store3 = new ValueStore(2);

    expect(store1._getWeakImmediateListenerCountForTest()).toEqual(0);

    const store4 = store1.flatMap(condition => (condition ? store2 : store3));

    expect(store1._getWeakImmediateListenerCountForTest()).toEqual(1);

    store1.flatMap(condition => (condition ? store3 : store2));

    expect(store1._getWeakImmediateListenerCountForTest()).toEqual(2);

    await waitMacrotask();
    global.gc!();

    expect(store1._getWeakImmediateListenerCountForTest()).toEqual(1);

    // Make sure `store4` is not garbage collected.
    store4.getSnapshot();
});
