import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {ValueStore} from "~/shared/store/value_store.js";

test("properly computes and caches values", () => {
    const store1 = new ValueStore(true);
    const store2 = new ValueStore(1);
    const store3 = new ValueStore(-1);

    const getSnapshot1 = (cast<{getSnapshot: () => boolean}>(store1).getSnapshot =
        import.meta.jest.fn(store1.getSnapshot));
    const getSnapshot2 = (cast<{getSnapshot: () => number}>(store2).getSnapshot =
        import.meta.jest.fn(store2.getSnapshot));
    const getSnapshot3 = (cast<{getSnapshot: () => number}>(store3).getSnapshot =
        import.meta.jest.fn(store3.getSnapshot));

    // Call each store twice to exercise computation store caching.
    const compute = import.meta.jest.fn(get => {
        get(store1);
        if (get(store1)) {
            get(store2);
            return get(store2);
        } else {
            get(store3);
            return get(store3);
        }
    });
    const store4 = computeStore(compute);

    const listener = import.meta.jest.fn();
    const weakImmediateListener = import.meta.jest.fn();

    store4.addListener(listener);
    store4._addWeakImmediateListener(weakImmediateListener);

    expect(compute.mock.calls.length).toEqual(0);
    expect(getSnapshot1.mock.calls.length).toEqual(0);
    expect(getSnapshot2.mock.calls.length).toEqual(0);
    expect(getSnapshot3.mock.calls.length).toEqual(0);
    expect(listener.mock.calls.length).toEqual(0);
    expect(weakImmediateListener.mock.calls.length).toEqual(0);

    expect(store4.getSnapshot()).toEqual(1);

    expect(compute.mock.calls.length).toEqual(1);
    expect(getSnapshot1.mock.calls.length).toEqual(1);
    expect(getSnapshot2.mock.calls.length).toEqual(1);
    expect(getSnapshot3.mock.calls.length).toEqual(0);
    expect(listener.mock.calls.length).toEqual(0);
    expect(weakImmediateListener.mock.calls.length).toEqual(0);

    expect(store4.getSnapshot()).toEqual(1);

    expect(compute.mock.calls.length).toEqual(1);
    expect(getSnapshot1.mock.calls.length).toEqual(2);
    expect(getSnapshot2.mock.calls.length).toEqual(2);
    expect(getSnapshot3.mock.calls.length).toEqual(0);
    expect(listener.mock.calls.length).toEqual(0);
    expect(weakImmediateListener.mock.calls.length).toEqual(0);

    store1.set(false);

    expect(compute.mock.calls.length).toEqual(1);
    expect(getSnapshot1.mock.calls.length).toEqual(2);
    expect(getSnapshot2.mock.calls.length).toEqual(2);
    expect(getSnapshot3.mock.calls.length).toEqual(0);
    expect(listener.mock.calls.length).toEqual(1);
    expect(weakImmediateListener.mock.calls.length).toEqual(1);

    expect(store4.getSnapshot()).toEqual(-1);

    expect(compute.mock.calls.length).toEqual(2);
    expect(getSnapshot1.mock.calls.length).toEqual(3);
    expect(getSnapshot2.mock.calls.length).toEqual(2);
    expect(getSnapshot3.mock.calls.length).toEqual(1);
    expect(listener.mock.calls.length).toEqual(1);
    expect(weakImmediateListener.mock.calls.length).toEqual(1);

    expect(store4.getSnapshot()).toEqual(-1);

    expect(compute.mock.calls.length).toEqual(2);
    expect(getSnapshot1.mock.calls.length).toEqual(4);
    expect(getSnapshot2.mock.calls.length).toEqual(2);
    expect(getSnapshot3.mock.calls.length).toEqual(2);
    expect(listener.mock.calls.length).toEqual(1);
    expect(weakImmediateListener.mock.calls.length).toEqual(1);

    store2.set(2);

    expect(compute.mock.calls.length).toEqual(2);
    expect(getSnapshot1.mock.calls.length).toEqual(4);
    expect(getSnapshot2.mock.calls.length).toEqual(2);
    expect(getSnapshot3.mock.calls.length).toEqual(2);
    expect(listener.mock.calls.length).toEqual(1);
    expect(weakImmediateListener.mock.calls.length).toEqual(1);

    expect(store4.getSnapshot()).toEqual(-1);

    expect(compute.mock.calls.length).toEqual(2);
    expect(getSnapshot1.mock.calls.length).toEqual(5);
    expect(getSnapshot2.mock.calls.length).toEqual(2);
    expect(getSnapshot3.mock.calls.length).toEqual(3);
    expect(listener.mock.calls.length).toEqual(1);
    expect(weakImmediateListener.mock.calls.length).toEqual(1);

    store3.set(-2);

    expect(compute.mock.calls.length).toEqual(2);
    expect(getSnapshot1.mock.calls.length).toEqual(5);
    expect(getSnapshot2.mock.calls.length).toEqual(2);
    expect(getSnapshot3.mock.calls.length).toEqual(3);
    expect(listener.mock.calls.length).toEqual(2);
    expect(weakImmediateListener.mock.calls.length).toEqual(2);

    expect(store4.getSnapshot()).toEqual(-2);

    expect(compute.mock.calls.length).toEqual(3);
    expect(getSnapshot1.mock.calls.length).toEqual(6);
    expect(getSnapshot2.mock.calls.length).toEqual(2);
    expect(getSnapshot3.mock.calls.length).toEqual(4);
    expect(listener.mock.calls.length).toEqual(2);
    expect(weakImmediateListener.mock.calls.length).toEqual(2);

    store1.set(true);

    expect(compute.mock.calls.length).toEqual(3);
    expect(getSnapshot1.mock.calls.length).toEqual(6);
    expect(getSnapshot2.mock.calls.length).toEqual(2);
    expect(getSnapshot3.mock.calls.length).toEqual(4);
    expect(listener.mock.calls.length).toEqual(3);
    expect(weakImmediateListener.mock.calls.length).toEqual(3);

    store3.set(-3);

    expect(compute.mock.calls.length).toEqual(3);
    expect(getSnapshot1.mock.calls.length).toEqual(6);
    expect(getSnapshot2.mock.calls.length).toEqual(2);
    expect(getSnapshot3.mock.calls.length).toEqual(4);
    expect(listener.mock.calls.length).toEqual(4);
    expect(weakImmediateListener.mock.calls.length).toEqual(4);

    store2.set(3);

    expect(compute.mock.calls.length).toEqual(3);
    expect(getSnapshot1.mock.calls.length).toEqual(6);
    expect(getSnapshot2.mock.calls.length).toEqual(2);
    expect(getSnapshot3.mock.calls.length).toEqual(4);
    expect(listener.mock.calls.length).toEqual(4);
    expect(weakImmediateListener.mock.calls.length).toEqual(4);

    expect(store4.getSnapshot()).toEqual(3);

    expect(compute.mock.calls.length).toEqual(4);
    expect(getSnapshot1.mock.calls.length).toEqual(7);
    expect(getSnapshot2.mock.calls.length).toEqual(3);
    expect(getSnapshot3.mock.calls.length).toEqual(4);
    expect(listener.mock.calls.length).toEqual(4);
    expect(weakImmediateListener.mock.calls.length).toEqual(4);

    store3.set(-4);

    expect(compute.mock.calls.length).toEqual(4);
    expect(getSnapshot1.mock.calls.length).toEqual(7);
    expect(getSnapshot2.mock.calls.length).toEqual(3);
    expect(getSnapshot3.mock.calls.length).toEqual(4);
    expect(listener.mock.calls.length).toEqual(4);
    expect(weakImmediateListener.mock.calls.length).toEqual(4);

    store2.set(4);

    expect(compute.mock.calls.length).toEqual(4);
    expect(getSnapshot1.mock.calls.length).toEqual(7);
    expect(getSnapshot2.mock.calls.length).toEqual(3);
    expect(getSnapshot3.mock.calls.length).toEqual(4);
    expect(listener.mock.calls.length).toEqual(5);
    expect(weakImmediateListener.mock.calls.length).toEqual(5);
});
