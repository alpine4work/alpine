/* eslint-disable cyberworlds/string-quotes */
import {decodeExtendedParameterValue} from "~/server/emails/mime/decode_extended_parameter_value.js";

const asciiSingleQuote = "'";

describe("decodeExtendedParameterValue", () => {
    test("decodes UTF-8 percent-escaped value with charset and language", () => {
        expect(
            decodeExtendedParameterValue(
                `UTF-8${asciiSingleQuote}fr-fr${asciiSingleQuote}%C3%A9cole.png`,
            ),
        ).toBe("école.png");
    });

    test("ignores the language tag between the two single quotes", () => {
        expect(
            decodeExtendedParameterValue(
                `UTF-8${asciiSingleQuote}en-us${asciiSingleQuote}%E2%82%AC%20100.pdf`,
            ),
        ).toBe("\u20ac 100.pdf");
    });

    test("supports an empty language tag", () => {
        expect(
            decodeExtendedParameterValue(
                `UTF-8${asciiSingleQuote}${asciiSingleQuote}new%20file.bin`,
            ),
        ).toBe("new file.bin");
    });

    test("decodes Latin-1 octets when charset is iso-8859-1", () => {
        expect(
            decodeExtendedParameterValue(
                `iso-8859-1${asciiSingleQuote}${asciiSingleQuote}caf%E9.txt`,
            ),
        ).toBe("café.txt");
    });

    test("falls back to UTF-8 percent-decoding when delimiters are missing", () => {
        expect(decodeExtendedParameterValue("report%20%231.pdf")).toBe("report #1.pdf");
    });

    test("trims whitespace before parsing", () => {
        expect(
            decodeExtendedParameterValue(
                `   UTF-8${asciiSingleQuote}${asciiSingleQuote}foo.txt   `,
            ),
        ).toBe("foo.txt");
    });

    test("strips a single pair of surrounding double quotes before parsing", () => {
        const quotedValue = `"UTF-8${asciiSingleQuote}${asciiSingleQuote}new%20file.bin"`;
        expect(decodeExtendedParameterValue(quotedValue)).toBe("new file.bin");
    });

    test("defaults to UTF-8 when the charset prefix is empty but delimiters are present", () => {
        expect(
            decodeExtendedParameterValue(`${asciiSingleQuote}${asciiSingleQuote}%C3%A9cole.png`),
        ).toBe("école.png");
    });

    test("leaves a stray % without two hex digits as a literal byte", () => {
        expect(decodeExtendedParameterValue(`UTF-8${asciiSingleQuote}${asciiSingleQuote}50%`)).toBe(
            "50%",
        );
    });
});
