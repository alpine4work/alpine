import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {randomFloat} from "~/shared/helpers/number/random_float.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {
    decodeVtencBigUint64List,
    encodeVtencBigUint64Set,
    isVtencBigInt64SetEmpty,
} from "~/shared/helpers/number/vtenc_big_uint_64_set.js";

function expectEncodeThenDecode(values: Array<bigint>) {
    expect(decodeVtencBigUint64List(encodeVtencBigUint64Set(values))).toEqual(
        Array.from(new Set(values)).sort((a, b) => Number(a - b)),
    );
}

test("can tell if a set is empty", () => {
    expect(isVtencBigInt64SetEmpty(encodeVtencBigUint64Set([]))).toEqual(true);
    expect(isVtencBigInt64SetEmpty(encodeVtencBigUint64Set([0n]))).toEqual(false);
    expect(isVtencBigInt64SetEmpty(encodeVtencBigUint64Set([1n]))).toEqual(false);
    expect(isVtencBigInt64SetEmpty(encodeVtencBigUint64Set([1n, 2n, 3n]))).toEqual(false);
});

test("basic cases", () => {
    expectEncodeThenDecode([]);
    expectEncodeThenDecode([1n]);
    expectEncodeThenDecode([420n]);
    expectEncodeThenDecode([1n, 2n, 3n]);
    expectEncodeThenDecode([20n]);
    expectEncodeThenDecode([10n, 20n, 30n]);
    expectEncodeThenDecode([2n ** 64n - 1n]);
    expectEncodeThenDecode([0n, 2n ** 31n - 1n, 2n ** 32n - 1n, 2n ** 63n - 1n, 2n ** 64n - 1n]);
});

test("random generative integer cases", () => {
    for (let i = 0; i < 2_000; i++) {
        const valuesLength = randomInteger(0, 500);

        const values = createArrayWithLength(
            valuesLength,
            () =>
                (BigInt(randomInteger(0, 2 ** 32 - 1)) << 32n) |
                BigInt(randomInteger(0, 2 ** 32 - 1)),
        );

        try {
            expectEncodeThenDecode(values);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(`Failed values: [\n${values.map(value => `    ${value}n,\n`).join("")}]`);
            throw error;
        }
    }
});

test("random generative timestamp cases", () => {
    for (let i = 0; i < 2_000; i++) {
        const valuesLength = randomInteger(0, 500);
        const durationMs = 1000 * 60 * 60 * 24 * valuesLength * randomFloat(3);

        const values = createArrayWithLength(valuesLength, () =>
            BigInt(Date.now() + randomInteger(durationMs)),
        );

        try {
            expectEncodeThenDecode(values);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(`Failed values: [\n${values.map(value => `    ${value}n,\n`).join("")}]`);
            throw error;
        }
    }
});
