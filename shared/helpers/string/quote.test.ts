import fc from "fast-check";
import {toMarkdown} from "mdast-util-to-markdown";
import {quote} from "~/shared/helpers/string/quote.js";

import.meta.jest.setTimeout(20 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 10 * 1000});

test.each([
    {unquoted: "hello", quoted: "`hello`"},
    {unquoted: "hello world", quoted: "`hello world`"},
    {unquoted: "`", quoted: "`` ` ``"},
    {unquoted: " ` ", quoted: "``  `  ``"},
    {unquoted: "``", quoted: "` `` `"},
    {unquoted: "` `` `", quoted: "``` ` `` ` ```"},
    {unquoted: " `` ", quoted: "`  ``  `"},
    // eslint-disable-next-line cyberworlds/string-quotes
])('"$unquoted" -> "$quoted"', ({unquoted, quoted}) => {
    expect(toMarkdown({type: "inlineCode", value: unquoted}).trim()).toBe(quoted);
    expect(quote(unquoted)).toBe(quoted);
});

test("can unscramble scrambled bytes", () => {
    fc.assert(
        fc.property(fc.string(), string => {
            expect(toMarkdown({type: "inlineCode", value: string}).trim()).toBe(quote(string));
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
