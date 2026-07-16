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
    {unquoted: '<comment id="4">', quoted: '`<comment id="4">`'},
    // eslint-disable-next-line cyberworlds/string-quotes
    {unquoted: '<comment id=\\\\"4\\\\">', quoted: '`<comment id=\\\\\\\\"4\\\\\\\\">`'},
    // eslint-disable-next-line cyberworlds/string-quotes
])('"$unquoted" -> "$quoted"', ({unquoted, quoted}) => {
    expect(
        JSON.stringify(
            toMarkdown({
                type: "paragraph",
                children: [{type: "inlineCode", value: unquoted}],
            }).trim(),
        )
            .slice(1, -1)
            // eslint-disable-next-line cyberworlds/string-quotes
            .replaceAll('\\"', '"'),
    ).toBe(quoted);

    expect(quote(unquoted)).toBe(quoted);
});

test("can quote the same as a markdown printer", () => {
    fc.assert(
        fc.property(fc.string(), unquoted => {
            expect(
                JSON.stringify(
                    toMarkdown({
                        type: "paragraph",
                        children: [{type: "inlineCode", value: unquoted}],
                    }).trim(),
                )
                    .slice(1, -1)
                    // eslint-disable-next-line cyberworlds/string-quotes
                    .replaceAll('\\"', '"'),
            ).toBe(quote(unquoted));
        }),
    );
});
