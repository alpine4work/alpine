import {compareArrays} from "~/shared/helpers/array/compare_arrays.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {
    decodeId,
    encodeId,
    generateId,
    getMaxId,
    getMinId,
    idLength,
    isId,
} from "~/shared/id/id.open_source.js";

test("max ID and min ID are IDs", () => {
    expect(isId(getMinId())).toEqual(true);
    expect(isId(getMaxId())).toEqual(true);
});

test("generates correct IDs", () => {
    for (let i = 0; i < 10_000; i++) {
        const id = generateId();
        expect(id.length).toEqual(idLength);

        expect(getMinId() <= id).toEqual(true);

        // We want to make sure ids are less than the maximum id to ensure ids only store
        // 128 bits of information. That way we can easily store ids in binary.
        expect(id <= getMaxId()).toEqual(true);

        expect(isId(id)).toEqual(true);

        expect([...decodeId(encodeId(decodeId(id)))]).toEqual([...decodeId(id)]);
    }
});

test("ID string order is the same as ID byte order", () => {
    const ids = createArrayWithLength(1_000, generateId);

    const sortedIds1 = Array.from(ids).sort((id1, id2) => defaultCompareStrings(id1, id2));

    const sortedIds2 = Array.from(ids, id => decodeId(id))
        .sort((id1, id2) => compareArrays(id1, id2, (byte1, byte2) => byte1 - byte2))
        .map(id => encodeId(id));

    expect(sortedIds1).toEqual(sortedIds2);
});
