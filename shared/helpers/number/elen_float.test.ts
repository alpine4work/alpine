import {
    decodeElenFloat,
    decodeElenFloatIfPossible,
    encodeElenFloat,
} from "~/shared/helpers/number/elen_float.js";

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

    const serializedIntegersSortedBeforeEncoding = sortedIntegers.map(encodeElenFloat);
    const serializedIntegersSortedAfterEncoding = integers.map(encodeElenFloat).sort();

    expect(serializedIntegersSortedBeforeEncoding.map(decodeElenFloat)).toEqual(sortedIntegers);
    expect(serializedIntegersSortedAfterEncoding).toEqual(serializedIntegersSortedBeforeEncoding);
});

test("encodes floats from 0 to 1 into strings with the right lexicographic order", () => {
    const numbers = [];

    for (let i = 0; i < 10_000; i++) {
        numbers.push(Math.random() * 2 - 1);
    }

    const sortedNumbers = Array.from(numbers).sort((a, b) => a - b);

    const serializedNumbersSortedBeforeEncoding = sortedNumbers.map(encodeElenFloat);
    const serializedNumbersSortedAfterEncoding = numbers.map(encodeElenFloat).sort();

    expect(serializedNumbersSortedBeforeEncoding.map(decodeElenFloat)).toEqual(sortedNumbers);
    expect(serializedNumbersSortedAfterEncoding).toEqual(serializedNumbersSortedBeforeEncoding);
});

test("encodes and decodes special float values", () => {
    expect(encodeElenFloat(+Infinity)).toEqual("===420470");
    expect(encodeElenFloat(-Infinity)).toEqual("---579520");
    expect(encodeElenFloat(+0)).toEqual("=00");
    expect(encodeElenFloat(-0)).toEqual("-00");
    expect(encodeElenFloat(+NaN)).toEqual("===42047===2162251799813685248");
    expect(encodeElenFloat(-NaN)).toEqual("---57952---7837748200186314751");

    expect(decodeElenFloatIfPossible("===420470")).toEqual(+Infinity);
    expect(decodeElenFloatIfPossible("---579520")).toEqual(-Infinity);
    expect(decodeElenFloatIfPossible("=00")).toEqual(+0);
    expect(decodeElenFloatIfPossible("-00")).toEqual(-0);
    expect(decodeElenFloatIfPossible("===42047===2162251799813685248")).toEqual(+NaN);
    expect(decodeElenFloatIfPossible("---57952---7837748200186314751")).toEqual(-NaN);
});

test("encodes floats into strings with the right lexicographic order", () => {
    const numbers: Array<number> = [];

    for (let i = 0; i < 10_000; i++) {
        numbers.push(Math.random() * 2000 - 1000);
    }

    const pushToRandomIndex = (value: number) => {
        const index = Math.floor(Math.random() * numbers.length);
        numbers.splice(index, 0, value);
    };

    pushToRandomIndex(+Infinity);
    pushToRandomIndex(-Infinity);

    const sortedNumbers = Array.from(numbers).sort((a, b) => a - b);

    const serializedNumbersSortedBeforeEncoding = sortedNumbers.map(encodeElenFloat);
    const serializedNumbersSortedAfterEncoding = numbers.map(encodeElenFloat).sort();

    expect(serializedNumbersSortedBeforeEncoding.map(decodeElenFloat)).toEqual(sortedNumbers);
    expect(serializedNumbersSortedAfterEncoding).toEqual(serializedNumbersSortedBeforeEncoding);
});
