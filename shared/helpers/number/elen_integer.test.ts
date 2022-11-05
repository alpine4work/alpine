import {decodeElenInteger, encodeElenInteger} from "~/shared/helpers/number/elen_integer";

test("encodes integers into strings with the right lexicographic order", () => {
    const integers = [];

    for (let i = 0; i < 10_000; i++) {
        integers.push(
            Math.floor(
                Math.random() *
                    Math.min(Math.abs(Number.MAX_SAFE_INTEGER), Math.abs(Number.MIN_SAFE_INTEGER)),
            ) * (Math.random() > 0.5 ? 1 : -1),
        );
    }

    for (let i = 0; i < 100; i++) {
        integers.push(Math.floor(Math.random() * 200) - 100);
    }

    const sortedIntegers = Array.from(integers).sort((a, b) => a - b);

    const serializedIntegersSortedBeforeEncoding = sortedIntegers.map(encodeElenInteger);
    const serializedIntegersSortedAfterEncoding = integers.map(encodeElenInteger).sort();

    expect(serializedIntegersSortedBeforeEncoding.map(decodeElenInteger)).toEqual(sortedIntegers);
    expect(serializedIntegersSortedAfterEncoding).toEqual(serializedIntegersSortedBeforeEncoding);
});
