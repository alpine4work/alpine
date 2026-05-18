import {compareArrays} from "~/shared/helpers/array/compare_arrays.js";
import {stableShuffleArray} from "~/shared/helpers/array/stable_shuffle_array.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {
    decodeOrderKey,
    encodeOrderKey,
    encodeOrderKeyInto,
    getOrderKeyByteCount,
} from "~/shared/helpers/sort/encode_order_key.js";
import {
    assertOrderKey,
    isOrderKey,
    maxOrderKey,
    minOrderKey,
    orderKeyDigits,
} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {quote} from "~/shared/helpers/string/quote.js";

function serializeBytes(orderKey: string) {
    return Array.from(encodeOrderKey(assertOrderKey(orderKey)));
}

const testCases = [
    {
        orderKey: "Zz",
        serializedBytes: ["93", "e0"],
    },
    {
        orderKey: "a0",
        serializedBytes: ["94", "10"],
    },
    {
        orderKey: "a00",
        serializedBytes: ["94", "10", "40"],
    },
    {
        orderKey: "a000",
        serializedBytes: ["94", "10", "41"],
    },
    {
        orderKey: "a0V",
        serializedBytes: ["94", "18", "00"],
    },
    {
        orderKey: "aF0",
        serializedBytes: ["95", "00", "40"],
    },
    {
        orderKey: "aF3",
        serializedBytes: ["95", "01", "00"],
    },
    {
        orderKey: "a1",
        serializedBytes: ["94", "20"],
    },
];

for (const {orderKey, serializedBytes} of testCases) {
    // eslint-disable-next-line jest/valid-title
    test(quote`serializes ${orderKey} to binary`, () => {
        expect(
            serializeBytes(orderKey).map(byte => byte.toString(16).toLowerCase().padStart(2, "0")),
        ).toEqual(serializedBytes);
    });

    // eslint-disable-next-line jest/valid-title
    test(quote`deserializes ${orderKey} from binary`, () => {
        expect(
            decodeOrderKey(new Uint8Array(serializedBytes.map(byte => parseInt(byte, 16)))),
        ).toEqual(assertOrderKey(orderKey));
    });
}

test("rounds the bit width up to the nearest byte", () => {
    expect(
        ["a0", "a00", "a000", "a0000", "a00000", "a000000"].map(orderKey =>
            getOrderKeyByteCount(assertOrderKey(orderKey)),
        ),
    ).toEqual([2, 3, 3, 4, 5, 6]);

    expect(getOrderKeyByteCount(minOrderKey)).toEqual(21);
    expect(getOrderKeyByteCount(maxOrderKey)).toEqual(21);
});

test("encodes into a larger byte array", () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

    encodeOrderKeyInto(assertOrderKey("a00"), bytes, 2);

    expect(Array.from(bytes)).toEqual([0xff, 0xff, 0x94, 0x10, 0x40, 0xff]);
});

test("can serialize/deserialize to binary in the right order", () => {
    const orderKeys = [
        minOrderKey,
        assertOrderKey("Zz"),
        assertOrderKey("a0"),
        assertOrderKey("a00"),
        assertOrderKey("a01"),
        assertOrderKey("a0V"),
        assertOrderKey("a0z"),
        assertOrderKey("a1"),
        assertOrderKey("a10"),
        assertOrderKey(`a0${orderKeyDigits}`),
        maxOrderKey,
    ];

    expect(Array.from(orderKeys).sort(defaultCompareStrings)).toEqual(
        orderKeys
            .map(orderKey => encodeOrderKey(orderKey))
            .sort((a, b) => compareArrays(a, b, (a, b) => a - b))
            .map(decodeOrderKey),
    );
});

test("binary order matches string order for many random order keys", () => {
    const stableRandom = new StableRandom("encodeOrderKeyTest");
    const orderKeys = [minOrderKey, maxOrderKey];

    function generateRandomOrderKey(index: number) {
        let attempt = 0;

        while (true) {
            const keyString = `orderKey:${index}:${attempt}`;
            const length = stableRandom.randomInteger(keyString, 0, 2, 52);
            const headIndex = stableRandom.randomInteger(keyString, 1, 10, orderKeyDigits.length);
            let orderKey = orderKeyDigits[headIndex]!;

            for (let i = 1; i < length; i++) {
                const digitIndex = stableRandom.randomInteger(
                    keyString,
                    i + 1,
                    orderKeyDigits.length,
                );
                orderKey += orderKeyDigits[digitIndex]!;
            }

            if (isOrderKey(orderKey)) return orderKey;

            attempt++;
        }
    }

    for (let i = 0; i < 1_000; i++) {
        orderKeys.push(generateRandomOrderKey(i));
    }

    stableShuffleArray(stableRandom, "orderKeys", orderKeys);

    expect(
        orderKeys
            .map(orderKey => encodeOrderKey(orderKey))
            .sort((a, b) => compareArrays(a, b, (a, b) => a - b))
            .map(decodeOrderKey),
    ).toEqual(Array.from(orderKeys).sort(defaultCompareStrings));
});
