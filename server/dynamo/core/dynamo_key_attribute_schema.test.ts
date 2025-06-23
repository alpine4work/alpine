import {
    DynamoKeyAttributeSchema,
    deserializeReversedDynamoKeyAttribute,
    dynamoKeyAttributeMaxCharCode,
    dynamoKeyAttributeMinCharCode,
    isDynamoKeyAttribute,
    serializeReversedDynamoKeyAttribute,
} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";

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
        // eslint-disable-next-line string-quotes
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

test("can serialize and deserialize label strings in the right order", () => {
    const strings = [
        "Hello, world!",
        "Hello, world.",
        "Hello, world?",
        "Hello, world",
        "😍",
        "\ud83d\ude0d",
        String.raw`\ud83d\ude0d`,
        "☃★♲",
        "foo#bar",
        "foo~bar",
        "foo$bar",
        "caleb.meredith@example.com",
        // eslint-disable-next-line string-quotes
        'So called "cats"',
    ];

    expect(Array.from(strings).sort()).toEqual(
        strings
            .map(string => {
                const serializedString = DynamoKeyAttributeSchema.labelString.serialize(string);
                expect(isDynamoKeyAttribute(serializedString)).toEqual(true);
                return serializedString;
            })
            .sort()
            .map(serializedString => {
                const deserializedString =
                    DynamoKeyAttributeSchema.labelString.deserialize(serializedString);
                return deserializedString;
            }),
    );
});
