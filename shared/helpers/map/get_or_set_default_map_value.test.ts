import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";

test("gets an existing entry", () => {
    const map = new Map([
        ["a", 1],
        ["b", 2],
    ]);

    expect(Array.from(map.entries())).toEqual([
        ["a", 1],
        ["b", 2],
    ]);

    expect(getOrSetDefaultMapValue(map, "a", () => 3)).toEqual(1);
    expect(getOrSetDefaultMapValue(map, "b", () => 3)).toEqual(2);

    expect(Array.from(map.entries())).toEqual([
        ["a", 1],
        ["b", 2],
    ]);
});

test("sets a new entry once if the key doesn\u2019t exist", () => {
    const map = new Map([
        ["a", 1],
        ["b", 2],
    ]);

    let callCount = 0;

    const getDefault = () => {
        callCount++;
        return 3;
    };

    expect(callCount).toEqual(0);
    expect(Array.from(map.entries())).toEqual([
        ["a", 1],
        ["b", 2],
    ]);

    expect(getOrSetDefaultMapValue(map, "c", getDefault)).toEqual(3);

    expect(callCount).toEqual(1);
    expect(Array.from(map.entries())).toEqual([
        ["a", 1],
        ["b", 2],
        ["c", 3],
    ]);

    expect(getOrSetDefaultMapValue(map, "c", getDefault)).toEqual(3);

    expect(callCount).toEqual(1);
    expect(Array.from(map.entries())).toEqual([
        ["a", 1],
        ["b", 2],
        ["c", 3],
    ]);
});

test("does not treat an undefined entry as a non-existing entry", () => {
    const map = new Map<string, number | undefined>([
        ["a", 1],
        ["b", 2],
    ]);

    let callCount = 0;

    const getDefault = () => {
        callCount++;
        return undefined;
    };

    expect(callCount).toEqual(0);
    expect(Array.from(map.entries())).toEqual([
        ["a", 1],
        ["b", 2],
    ]);

    expect(getOrSetDefaultMapValue(map, "c", getDefault)).toEqual(undefined);

    expect(callCount).toEqual(1);
    expect(Array.from(map.entries())).toEqual([
        ["a", 1],
        ["b", 2],
        ["c", undefined],
    ]);

    expect(getOrSetDefaultMapValue(map, "c", getDefault)).toEqual(undefined);

    expect(callCount).toEqual(1);
    expect(Array.from(map.entries())).toEqual([
        ["a", 1],
        ["b", 2],
        ["c", undefined],
    ]);
});
