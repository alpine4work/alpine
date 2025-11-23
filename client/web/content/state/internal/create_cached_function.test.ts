import {createCachedFunction} from "~/client/web/content/state/internal/create_cached_function.js";

test("cached function returns the exact same value when provided the same arguments", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const compute = createCachedFunction((...args: Array<any>) => Symbol());

    const object1 = {};
    const object2 = {};
    const object3 = {};

    expect(compute(object1, object2, object3, "foo", "bar")).toEqual(
        compute(object1, object2, object3, "foo", "bar"),
    );
    expect(compute(object1, object2, object3, "bar", "foo")).not.toEqual(
        compute(object1, object2, object3, "foo", "bar"),
    );
    expect(compute(object3, object2, object1, "foo", "bar")).not.toEqual(
        compute(object1, object2, object3, "foo", "bar"),
    );
    expect(compute(object1, null, object3, "foo", "bar")).not.toEqual(
        compute(object1, object2, object3, "foo", "bar"),
    );
    expect(compute(object1, null, object3, "foo", "bar")).toEqual(
        compute(object1, null, object3, "foo", "bar"),
    );
    expect(compute(null, object1, object3, "foo", "bar")).not.toEqual(
        compute(object1, null, object3, "foo", "bar"),
    );
    expect(compute("foo", object1, null, object3, "bar")).not.toEqual(
        compute(object1, null, object3, "foo", "bar"),
    );
    expect(compute("foo", object1, object2, object3, "bar")).not.toEqual(
        compute(object1, object2, object3, "foo", "bar"),
    );
});
