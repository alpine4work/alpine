import {
    deserializeReversedDynamoKeyAttribute,
    dynamoKeyAttributeMaxCharCode,
    dynamoKeyAttributeMinCharCode,
    isDynamoKeyAttribute,
    serializeReversedDynamoKeyAttribute,
} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {assert} from "~/shared/helpers/control/assert";
import {defaultCompareStrings} from "~/shared/helpers/string/default-compare-strings";

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
