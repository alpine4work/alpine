import fc from "fast-check";
import {toMarkdown} from "mdast-util-to-markdown";
import {quote} from "~/shared/helpers/string/quote.js";

test.each([
    {unquoted: "hello", quoted: "`hello`"},
    {unquoted: "hello world", quoted: "`hello world`"},
    {unquoted: "`", quoted: "`` ` ``"},
    {unquoted: " ` ", quoted: "``  `  ``"},
    {unquoted: "``", quoted: "` `` `"},
    {unquoted: "` `` `", quoted: "``` ` `` ` ```"},
    {unquoted: " `` ", quoted: "`  ``  `"},
    {
        unquoted: "errorDisplayMessage`hello world`",
        quoted: "`` errorDisplayMessage`hello world` ``",
    },
    {unquoted: "hello\nworld", quoted: "`hello\\nworld`"},
    {unquoted: "hello`world", quoted: "``hello`world``"},
    // eslint-disable-next-line cyberworlds/string-quotes
])('"$unquoted" -> "$quoted"', ({unquoted, quoted}) => {
    expect(
        toMarkdown({type: "inlineCode", value: unquoted})
            .trim()
            .replaceAll(/[\n\r]/g, substring => (substring === "\n" ? "\\n" : "\\r")),
    ).toBe(quoted);

    expect(quote(unquoted)).toBe(quoted);
});

test("can quote the same as a markdown printer", () => {
    fc.assert(
        fc.property(fc.string(), string => {
            expect(
                toMarkdown({type: "inlineCode", value: string})
                    .trim()
                    .replaceAll(/[\n\r]/g, substring => (substring === "\n" ? "\\n" : "\\r")),
            ).toBe(quote(string));
        }),
    );
});
