import {
    DynamoKeyAttribute,
    DynamoKeyAttributeSchema,
    deserializeReversedDynamoKeyAttribute,
    dynamoKeyAttributeMaxCharCode,
    dynamoKeyAttributeMinCharCode,
    isDynamoKeyAttribute,
    maxLabelStringForDynamoKeyAttribute,
    serializeReversedDynamoKeyAttribute,
} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {compareArrays} from "~/shared/helpers/array/compare_arrays.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {minLabelString} from "~/shared/schema/helpers/label_string_schema.js";

test("key attributes can be a reasonable set of ASCII characters", () => {
    const chars = [];

    for (
        let charCode = dynamoKeyAttributeMinCharCode;
        charCode <= dynamoKeyAttributeMaxCharCode;
        charCode++
    ) {
        const char = String.fromCharCode(charCode);
        expect(isDynamoKeyAttribute(char)).toEqual(true);
        chars.push(char);
    }

    expect(chars).toEqual([
        "$",
        "%",
        "&",
        // eslint-disable-next-line cyberworlds/string-quotes
        "'",
        "(",
        ")",
        "*",
        "+",
        ",",
        "-",
        ".",
        "/",
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        ":",
        ";",
        "<",
        "=",
        ">",
        "?",
        "@",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
        "I",
        "J",
        "K",
        "L",
        "M",
        "N",
        "O",
        "P",
        "Q",
        "R",
        "S",
        "T",
        "U",
        "V",
        "W",
        "X",
        "Y",
        "Z",
        "[",
        "\\",
        "]",
        "^",
        "_",
        "`",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
        "h",
        "i",
        "j",
        "k",
        "l",
        "m",
        "n",
        "o",
        "p",
        "q",
        "r",
        "s",
        "t",
        "u",
        "v",
        "w",
        "x",
        "y",
        "z",
        "{",
        "|",
        "}",
        "~",
    ]);
});

test("can serialize and deserialize a reversed key attribute", () => {
    function generateRandomDynamoKeyAttribute() {
        const length = Math.floor(Math.random() * 100) + 1;
        const chars = [];

        for (let index = 0; index < length; index++) {
            const charCode =
                Math.floor(
                    Math.random() * (dynamoKeyAttributeMaxCharCode - dynamoKeyAttributeMinCharCode),
                ) + dynamoKeyAttributeMinCharCode;

            chars.push(String.fromCharCode(charCode));
        }

        const string = chars.join("");
        assert(isDynamoKeyAttribute(string));
        return string;
    }

    const strings = [];

    for (let i = 0; i < 10_000; i++) {
        strings.push(generateRandomDynamoKeyAttribute());
    }

    const sortedStrings = Array.from(strings).sort(defaultCompareStrings).reverse();

    const reversedStringsSortedBeforeSerialization = sortedStrings.map(
        serializeReversedDynamoKeyAttribute,
    );
    const reversedStringsSortedAfterSerialization = strings
        .map(serializeReversedDynamoKeyAttribute)
        .sort();

    expect(
        reversedStringsSortedBeforeSerialization.map(deserializeReversedDynamoKeyAttribute),
    ).toEqual(sortedStrings);
    expect(reversedStringsSortedAfterSerialization).toEqual(
        reversedStringsSortedBeforeSerialization,
    );
});

// Make sure our assumptions about how string reversal works are correct. This is
// not testing any of our logic, but is an artifact for how and why we implemented
// labelString serialization.
test("UTF-8 and UTF-16 sort differently", () => {
    const a = String.fromCharCode(0xffff);
    const b = "😍";

    // UTF-16 encoding sorts one way
    expect(defaultCompareStrings(a, b)).toEqual(1);

    // UTF-8 encoding sorts another
    expect(
        compareArrays(new TextEncoder().encode(a), new TextEncoder().encode(b), (byte1, byte2) =>
            clamp(-1, byte1 - byte2, 1),
        ),
    ).toEqual(-1);

    expect(createArrayWithLength(a.length, i => a.charCodeAt(i))).toEqual([65535]);
    expect(createArrayWithLength(b.length, i => b.charCodeAt(i))).toEqual([55357, 56845]);

    expect(Array.from(new TextEncoder().encode(a))).toEqual([239, 191, 191]);
    expect(Array.from(new TextEncoder().encode(b))).toEqual([240, 159, 152, 141]);
});

describe("`labelString`", () => {
    const testCases = [
        {
            string: "a\0b",
            serializedString: "a$u00b",
            serializedBytes: ["61", "0a", "00", "62", "00"],
        },
        {
            string: minLabelString,
            serializedString: "$u00",
            serializedBytes: ["0a", "00", "00"],
        },
        {
            string: String.fromCharCode(0xffff),
            serializedString: "~uEF~uBF~uBF",
            serializedBytes: ["ef", "bf", "bf", "00"],
        },
        {
            string: maxLabelStringForDynamoKeyAttribute,
            serializedString: "~uF4~u8F~uBF~uBF",
            serializedBytes: ["f4", "8f", "bf", "bf", "00"],
        },
        {
            string: "Hello, world!",
            serializedString: "Hello,$u20world$u21",
            serializedBytes: [
                "48",
                "65",
                "6c",
                "6c",
                "6f",
                "2c",
                "20",
                "77",
                "6f",
                "72",
                "6c",
                "64",
                "21",
                "00",
            ],
        },
        {
            string: "Hello, world.",
            serializedString: "Hello,$u20world.",
            serializedBytes: [
                "48",
                "65",
                "6c",
                "6c",
                "6f",
                "2c",
                "20",
                "77",
                "6f",
                "72",
                "6c",
                "64",
                "2e",
                "00",
            ],
        },
        {
            string: "Hello, world?",
            serializedString: "Hello,$u20world?",
            serializedBytes: [
                "48",
                "65",
                "6c",
                "6c",
                "6f",
                "2c",
                "20",
                "77",
                "6f",
                "72",
                "6c",
                "64",
                "3f",
                "00",
            ],
        },
        {
            string: "Hello, world",
            serializedString: "Hello,$u20world",
            serializedBytes: [
                "48",
                "65",
                "6c",
                "6c",
                "6f",
                "2c",
                "20",
                "77",
                "6f",
                "72",
                "6c",
                "64",
                "00",
            ],
        },
        {
            string: "😍",
            serializedString: "~uF0~u9F~u98~u8D",
            serializedBytes: ["f0", "9f", "98", "8d", "00"],
        },
        {
            string: "\ud83d\ude0d",
            serializedString: "~uF0~u9F~u98~u8D",
            serializedBytes: ["f0", "9f", "98", "8d", "00"],
        },
        {
            string: String.raw`\ud83d\ude0d`,
            serializedString: String.raw`\ud83d\ude0d`,
            serializedBytes: [
                "5c",
                "75",
                "64",
                "38",
                "33",
                "64",
                "5c",
                "75",
                "64",
                "65",
                "30",
                "64",
                "00",
            ],
        },
        {
            string: "☃★♲",
            serializedString: "~uE2~u98~u83~uE2~u98~u85~uE2~u99~uB2",
            serializedBytes: ["e2", "98", "83", "e2", "98", "85", "e2", "99", "b2", "00"],
        },
        {
            string: "foo#bar",
            serializedString: "foo$u23bar",
            serializedBytes: ["66", "6f", "6f", "23", "62", "61", "72", "00"],
        },
        {
            string: "foo~bar",
            serializedString: "foo~u7Ebar",
            serializedBytes: ["66", "6f", "6f", "7e", "62", "61", "72", "00"],
        },
        {
            string: "foo$bar",
            serializedString: "foo$u24bar",
            serializedBytes: ["66", "6f", "6f", "24", "62", "61", "72", "00"],
        },
        {
            string: "caleb.meredith@example.com",
            serializedString: "caleb.meredith@example.com",
            serializedBytes: [
                "63",
                "61",
                "6c",
                "65",
                "62",
                "2e",
                "6d",
                "65",
                "72",
                "65",
                "64",
                "69",
                "74",
                "68",
                "40",
                "65",
                "78",
                "61",
                "6d",
                "70",
                "6c",
                "65",
                "2e",
                "63",
                "6f",
                "6d",
                "00",
            ],
        },
        {
            // eslint-disable-next-line cyberworlds/string-quotes
            string: 'So called "cats"',
            serializedString: "So$u20called$u20$u22cats$u22",
            serializedBytes: [
                "53",
                "6f",
                "20",
                "63",
                "61",
                "6c",
                "6c",
                "65",
                "64",
                "20",
                "22",
                "63",
                "61",
                "74",
                "73",
                "22",
                "00",
            ],
        },
    ];

    function testSerializeBytes<Value>(schema: DynamoKeyAttributeSchema<Value>, value: Value) {
        const bytes = new Uint8Array(schema.binary!.getByteCount(value));
        schema.binary!.serializeBytes(value, bytes, 0);
        return Array.from(bytes);
    }

    test("can serialize/deserialize to strings in the right order", () => {
        const schema = DynamoKeyAttributeSchema.labelString();

        expect(
            Array.from(testCases.map(({string}) => string)).sort((a, b) =>
                compareArrays(
                    new TextEncoder().encode(a),
                    new TextEncoder().encode(b),
                    (a, b) => a - b,
                ),
            ),
        ).toEqual(
            testCases
                .map(({string}) => string)
                .map(string => {
                    const serializedString = schema.serialize(string);
                    expect(isDynamoKeyAttribute(serializedString)).toEqual(true);
                    return serializedString;
                })
                .sort()
                .map(serializedString => {
                    const deserializedString = schema.deserialize(serializedString);
                    return deserializedString;
                }),
        );
    });

    test("can serialize/deserialize to binary in the right order", () => {
        const schema = DynamoKeyAttributeSchema.labelString();

        expect(
            Array.from(testCases.map(({string}) => string)).sort((a, b) =>
                compareArrays(
                    new TextEncoder().encode(a),
                    new TextEncoder().encode(b),
                    (a, b) => a - b,
                ),
            ),
        ).toEqual(
            testCases
                .map(({string}) => string)
                .map(string => {
                    const serializedBytes = testSerializeBytes(schema, string);
                    return new Uint8Array(serializedBytes);
                })
                .sort((a, b) => compareArrays(a, b, (a, b) => a - b))
                .map(serializedBytes => {
                    const deserializedString = schema.binary!.deserializeBytes(serializedBytes, 0);
                    return deserializedString;
                }),
        );
    });

    for (const {string, serializedString, serializedBytes} of testCases) {
        // eslint-disable-next-line jest/valid-title
        test(quote`serializes ${string} to string`, () => {
            const schema = DynamoKeyAttributeSchema.labelString();

            expect(schema.serialize(string)).toEqual(serializedString);
        });

        // eslint-disable-next-line jest/valid-title
        test(quote`serializes ${string} to binary`, () => {
            const schema = DynamoKeyAttributeSchema.labelString();

            expect(
                testSerializeBytes(schema, string).map(byte =>
                    byte.toString(16).toLowerCase().padStart(2, "0"),
                ),
            ).toEqual(serializedBytes);
        });

        // eslint-disable-next-line jest/valid-title
        test(quote`deserializes ${string} from string`, () => {
            const schema = DynamoKeyAttributeSchema.labelString();

            expect(schema.deserialize(serializedString as DynamoKeyAttribute)).toEqual(string);
        });

        // eslint-disable-next-line jest/valid-title
        test(quote`deserializes ${string} from binary`, () => {
            const schema = DynamoKeyAttributeSchema.labelString();

            expect(
                schema.binary!.deserializeBytes(
                    new Uint8Array(serializedBytes.map(byte => parseInt(byte, 16))),
                    0,
                ),
            ).toEqual(string);

            // Make sure caching after deserialization works.
            expect(schema.binary!.getByteCount(string)).toEqual(serializedBytes.length);
        });

        test(
            // eslint-disable-next-line jest/valid-title
            quote`deserializes ${string} from binary when there\u2019s extra data before/after`,
            () => {
                const schema = DynamoKeyAttributeSchema.labelString();

                for (let i = 0; i < 100; i++) {
                    expect(
                        schema.binary!.deserializeBytes(
                            new Uint8Array([
                                randomInteger(0, 256),
                                randomInteger(0, 256),
                                randomInteger(0, 256),
                                randomInteger(0, 256),
                                ...serializedBytes.map(byte => parseInt(byte, 16)),
                                randomInteger(0, 256),
                                randomInteger(0, 256),
                                randomInteger(0, 256),
                                randomInteger(0, 256),
                            ]),
                            4,
                        ),
                    ).toEqual(string);
                }
            },
        );

        // eslint-disable-next-line jest/valid-title
        test(quote`gets ${string} byte count`, () => {
            const schema = DynamoKeyAttributeSchema.labelString();

            expect(schema.binary!.getByteCount(string)).toEqual(serializedBytes.length);
        });
    }
});
