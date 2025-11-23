import {
    ProgressValueStore,
    createProgressCompositeStore,
} from "~/client/web/content/internal/progress_store.js";

import.meta.jest.useFakeTimers();

test("can create a composite progress store", () => {
    const [compositeStore, [store1, store2, store3]] = createProgressCompositeStore([1, 1, 2]);

    expect(compositeStore.getSnapshot()).toEqual(0);
    store1.set(0.25);
    expect(compositeStore.getSnapshot()).toEqual(0.0625);
    store2.set(0.25);
    expect(compositeStore.getSnapshot()).toEqual(0.125);
    store3.set(0.25);
    expect(compositeStore.getSnapshot()).toEqual(0.25);
    store3.set(2 / 3);
    expect(compositeStore.getSnapshot()).toEqual(0.4583333333333333);
    store2.set(0.5);
    expect(compositeStore.getSnapshot()).toEqual(0.5208333333333333);
    store2.set(0.75);
    expect(compositeStore.getSnapshot()).toEqual(0.5833333333333333);
    store3.set(0.75);
    expect(compositeStore.getSnapshot()).toEqual(0.625);
    store3.set(1);
    expect(compositeStore.getSnapshot()).toEqual(0.75);
    store2.set(1);
    expect(compositeStore.getSnapshot()).toEqual(0.8125);
    store1.set(0.5);
    expect(compositeStore.getSnapshot()).toEqual(0.875);
    store1.set(0.75);
    expect(compositeStore.getSnapshot()).toEqual(0.9375);
    store1.set(1);
    expect(compositeStore.getSnapshot()).toEqual(1);
});

test("can create a composite progress store with cancellation", () => {
    const [compositeStore, [store1, store2, store3]] = createProgressCompositeStore([1, 1, 2]);

    expect(compositeStore.getSnapshot()).toEqual(0);
    store1.set(0.25);
    expect(compositeStore.getSnapshot()).toEqual(0.0625);
    store2.set(0.25);
    expect(compositeStore.getSnapshot()).toEqual(0.125);
    store3.set(0.25);
    expect(compositeStore.getSnapshot()).toEqual(0.25);
    store3.set(2 / 3);
    expect(compositeStore.getSnapshot()).toEqual(0.4583333333333333);
    store2.set(0.5);
    expect(compositeStore.getSnapshot()).toEqual(0.5208333333333333);
    store1.cancel();
    expect(compositeStore.getSnapshot()).toEqual(0.5208333333333333);
    store2.set(0.75);
    expect(compositeStore.getSnapshot()).toEqual(0.6235119047619045);
    store3.set(0.75);
    expect(compositeStore.getSnapshot()).toEqual(0.6919642857142857);
    store3.set(1);
    expect(compositeStore.getSnapshot()).toEqual(0.8973214285714286);
    store2.set(1);
    expect(compositeStore.getSnapshot()).toEqual(1);
});

test("can ease value progress store", () => {
    const store = new ProgressValueStore();

    const snapshots = [];

    snapshots.push(store.getSnapshot());
    store.ease(3000);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());
    import.meta.jest.advanceTimersByTime(250);
    snapshots.push(store.getSnapshot());

    expect(snapshots).toEqual([
        0, 0,
        // 0s
        0.2888368592592592, 0.5921412037037036, 0.7277786185185185, 0.8596296296296295,
        // 1s
        0.9130176, 0.9590625, 0.9748732481481481, 0.985925925925926,
        // 2s
        0.9886650074074075, 0.9898726851851852, 0.9899901, 0.99,
        // 3s
    ]);
});
