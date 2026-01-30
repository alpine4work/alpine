import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {
    ChronologicalId,
    generateChronologicalId,
    generateChronologicalIdWithTime,
    getDecodedChronologicalIdTime,
    maxChronologicalIdTime,
} from "~/shared/id/chronological_id.js";
import {Id, RandomId, decodeId, generateId} from "~/shared/id/id.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.js";

test("can\u2019t use `generateId()` to generate a `ChronologicalId`", () => {
    // @ts-expect-error
    generateId<Id>();

    generateId<RandomId>();

    generateId<AccountId>();

    // @ts-expect-error
    generateId<ChronologicalId>();

    // @ts-expect-error
    generateId<FileId>();
});

test("can\u2019t use `generateChronologicalId()` to generate a `RandomId`", () => {
    // @ts-expect-error
    generateChronologicalId<Id>();

    // @ts-expect-error
    generateChronologicalId<RandomId>();

    // @ts-expect-error
    generateChronologicalId<AccountId>();

    generateChronologicalId<ChronologicalId>();

    generateChronologicalId<FileId>();
});

test("generates monotonically increasing ids", () => {
    let lastId = generateChronologicalId();

    for (let i = 0; i < 10_000; i++) {
        const nextId = generateChronologicalId();

        expect(lastId < nextId).toEqual(true);

        lastId = nextId;
    }
});

test("providing a custom time doesn\u2019t effect monotonically increasing ids", () => {
    const futureTime = Date.now() + 1000 * 60 * 60;
    const futureId = generateChronologicalIdWithTime(futureTime);

    let lastId = generateChronologicalId();

    for (let i = 0; i < 100; i++) {
        const nextId = generateChronologicalId();

        expect(lastId < nextId).toEqual(true);
        expect(nextId < futureId).toEqual(true);

        lastId = nextId;
    }
});

test("ids are ordered by time", () => {
    const ids = createArrayWithLength(1_000, () => {
        const time = randomInteger(0, maxChronologicalIdTime);
        return {time, id: generateChronologicalIdWithTime(time)};
    });

    const sortedIds1 = Array.from(ids).sort((id1, id2) => id1.time - id2.time);
    const sortedIds2 = Array.from(ids).sort((id1, id2) => defaultCompareStrings(id1.id, id2.id));

    expect(sortedIds1).toEqual(sortedIds2);
});

test("can get the time encoded in the chronological id", () => {
    for (let i = 0; i < 1_000; i++) {
        const time = randomInteger(0, maxChronologicalIdTime);

        expect(
            getDecodedChronologicalIdTime(decodeId(generateChronologicalIdWithTime(time))),
        ).toEqual(time);
    }
});

test("generates a chronological id with the current time", () => {
    for (let i = 0; i < 100; i++) {
        const currentTime = Date.now();
        const generatedTime = getDecodedChronologicalIdTime(decodeId(generateChronologicalId()));

        expect(generatedTime).toBeLessThanOrEqual(currentTime + 500);
        expect(generatedTime).toBeGreaterThanOrEqual(currentTime - 500);
    }
});

test("generates a random payload in addition to the time", () => {
    const time = Date.now();
    const id1 = generateChronologicalIdWithTime(time);
    const id2 = generateChronologicalIdWithTime(time);

    expect(id1).not.toEqual(id2);
});
