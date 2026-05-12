/* eslint-disable cyberworlds/string-quotes */
import {
    parseSemicolonSeparatedHeaderParameters,
    semicolonSeparatedHeaderLeadingTokenParameterName,
} from "~/server/emails/mime/parse_content_disposition_parameters.js";

const asciiSingleQuote = "'";

describe("parseSemicolonSeparatedHeaderParameters", () => {
    test("returns only the leading token when there is no semicolon", () => {
        expect(parseSemicolonSeparatedHeaderParameters("attachment")).toEqual([
            {name: semicolonSeparatedHeaderLeadingTokenParameterName, value: "attachment"},
        ]);
    });

    test("includes unquoted filename like a normal parameter after the leading token", () => {
        expect(parseSemicolonSeparatedHeaderParameters("attachment; filename=foo")).toEqual([
            {name: semicolonSeparatedHeaderLeadingTokenParameterName, value: "attachment"},
            {name: "filename", value: "foo"},
        ]);
    });

    test("parses the leading token as the first entry then parameters", () => {
        expect(
            parseSemicolonSeparatedHeaderParameters(
                `attachment; filename*="UTF-8'fr-fr'%C3%A9cole.png"; size=123`,
            ),
        ).toEqual([
            {name: semicolonSeparatedHeaderLeadingTokenParameterName, value: "attachment"},
            {name: "filename*", value: "UTF-8'fr-fr'%C3%A9cole.png"},
            {name: "size", value: "123"},
        ]);
    });

    test("parses the media type as the leading token for Content-Type-style values", () => {
        const nameStarValue = `UTF-8${asciiSingleQuote}${asciiSingleQuote}x.bin`;
        expect(
            parseSemicolonSeparatedHeaderParameters(
                `application/octet-stream; name*=${nameStarValue}`,
            ),
        ).toEqual([
            {
                name: semicolonSeparatedHeaderLeadingTokenParameterName,
                value: "application/octet-stream",
            },
            {name: "name*", value: nameStarValue},
        ]);
    });

    test("lowercases parameter names but not the leading token value", () => {
        expect(parseSemicolonSeparatedHeaderParameters("inline; FILENAME=doc.txt")).toEqual([
            {name: semicolonSeparatedHeaderLeadingTokenParameterName, value: "inline"},
            {name: "filename", value: "doc.txt"},
        ]);
    });

    test("allows optional whitespace before the name, around equals, and before quoted values", () => {
        expect(
            parseSemicolonSeparatedHeaderParameters(
                `attachment;  foo  =  bar ;\tname\t=\t"doc.pdf"`,
            ),
        ).toEqual([
            {name: semicolonSeparatedHeaderLeadingTokenParameterName, value: "attachment"},
            {name: "foo", value: "bar"},
            {name: "name", value: "doc.pdf"},
        ]);
    });

    test("treats backslash as escaping the next character inside a quoted value", () => {
        const headerWithEscapedQuote = `attachment; note="y\\"z"`;
        expect(parseSemicolonSeparatedHeaderParameters(headerWithEscapedQuote)).toEqual([
            {name: semicolonSeparatedHeaderLeadingTokenParameterName, value: "attachment"},
            {name: "note", value: `y\\"z`},
        ]);
    });

    test("trims unquoted token values", () => {
        expect(parseSemicolonSeparatedHeaderParameters("attachment; size=  42  ;")).toEqual([
            {name: semicolonSeparatedHeaderLeadingTokenParameterName, value: "attachment"},
            {name: "size", value: "42"},
        ]);
    });
});
