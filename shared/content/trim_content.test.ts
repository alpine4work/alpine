import {Fragment, Mark, Node} from "prosemirror-model";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    trimContent,
    trimContentEnd,
    trimContentFragment,
    trimContentFragmentEnd,
    trimContentFragmentStart,
    trimContentStart,
} from "~/shared/content/trim_content.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MessageContentProsemirrorSchema as schema} from "~/shared/messaging/message_content_schema.js";

// Helper function to create a document from content
const doc = (...content: Array<Node>) => schema.nodes.doc.create(null, content);
const p = (...content: Array<Node>) => schema.nodes.paragraph.create(null, content);
const text = (string: string, marks: Array<Mark> = []) => schema.text(string, marks);
const codeBlock = (...lines: Array<Node>) => schema.nodes.codeBlock.create(null, lines);
const codeLine = (...content: Array<Node>) => schema.nodes.codeBlockLine.create(null, content);
const quoteBlock = (...content: Array<Node>) => schema.nodes.quoteBlock.create(null, content);
const ul = (indent: number, ...content: Array<Node>) =>
    schema.nodes.unorderedListItem.create({indent}, content);
const ol = (indent: number, ...content: Array<Node>) =>
    schema.nodes.orderedListItem.create({indent}, content);
const br = schema.nodes.break.create();
const mention = (accountId: AccountId) =>
    schema.nodes.mention.create({
        mention: cast<ContentMention>({type: "Account", accountId, isShort: false}),
    });
const bold = schema.marks.bold.create();
const italic = schema.marks.italic.create();

test("`trimContentEnd()` removes trailing spaces from simple paragraph", () => {
    const input = doc(p(text("Hello world   ")));
    const expected = doc(p(text("Hello world")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` preserves content without trailing spaces", () => {
    const input = doc(p(text("Hello world")));
    expect(trimContentEnd(input)).toBe(input); // Should return same instance
});

test("`trimContentEnd()` removes trailing empty paragraph", () => {
    const input = doc(p(text("Hello")), p(text("   ")));
    const expected = doc(p(text("Hello")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` removes multiple trailing empty paragraphs", () => {
    const input = doc(p(text("Hello")), p(text("   ")), p());
    const expected = doc(p(text("Hello")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles nested quote blocks", () => {
    const input = quoteBlock(p(text("Quote")), p(text("   ")));
    const expected = quoteBlock(p(text("Quote")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` removes trailing space from code block", () => {
    const input = doc(codeBlock(codeLine(text("  function() {  "))));
    const expected = doc(codeBlock(codeLine(text("  function() {"))));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles list items", () => {
    const input = doc(ul(0, p(text("Item 1  "))), ul(1, p(text("Nested item  "))));
    const expected = doc(ul(0, p(text("Item 1  "))), ul(1, p(text("Nested item"))));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` removes trailing spaces in list item at end", () => {
    const input = doc(ul(0, p(text("Item 1"))), ul(0, p(text("  "))));
    const expected = doc(ul(0, p(text("Item 1"))), ul(0, p()));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles marks on trailing text", () => {
    const input = doc(p(text("Hello "), text("world  ", [bold])));
    const expected = doc(p(text("Hello "), text("world", [bold])));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles inline nodes at end", () => {
    const input = doc(p(text("Hello"), br, text("  ")));
    const expected = doc(p(text("Hello"), br));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles mentions at end", () => {
    const accountId = generateId<AccountId>();
    const input = doc(p(text("Hello "), mention(accountId), text("  ")));
    const expected = doc(p(text("Hello "), mention(accountId)));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles empty document", () => {
    const input = doc(p());
    expect(trimContentEnd(input)).toEqual(input);
});

test("`trimContentEnd()` handles document with only spaces", () => {
    const input = doc(p(text("   ")));
    const expected = doc(p());
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles complex nested structure", () => {
    const input = doc(
        p(text("First")),
        quoteBlock(p(text("Quote")), ul(0, p(text("List in quote  ")))),
        p(text("  ")),
    );
    const expected = doc(
        p(text("First")),
        quoteBlock(p(text("Quote")), ul(0, p(text("List in quote")))),
    );
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` preserves middle spaces", () => {
    const input = doc(p(text("Hello   world  ")));
    const expected = doc(p(text("Hello   world")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles tabs and newlines", () => {
    const input = doc(p(text("Hello\t\n  ")));
    const expected = doc(p(text("Hello")));
    expect(trimContentEnd(input)).toEqual(expected);
});

// Tests for trimContentStart()
test("`trimContentStart()` removes leading spaces from simple paragraph", () => {
    const input = doc(p(text("   Hello world")));
    const expected = doc(p(text("Hello world")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` preserves content without leading spaces", () => {
    const input = doc(p(text("Hello world")));
    expect(trimContentStart(input)).toBe(input); // Should return same instance
});

test("`trimContentStart()` removes leading empty paragraph", () => {
    const input = doc(p(text("   ")), p(text("Hello")));
    const expected = doc(p(text("Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` removes multiple leading empty paragraphs", () => {
    const input = doc(p(), p(text("   ")), p(text("Hello")));
    const expected = doc(p(text("Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles nested quote blocks", () => {
    const input = quoteBlock(p(text("   ")), p(text("Quote")));
    const expected = quoteBlock(p(text("Quote")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` preserves code block spaces", () => {
    const input = doc(codeBlock(codeLine(text("  function() {"))));
    // Code blocks should preserve all spaces
    expect(trimContentStart(input)).toBe(input);
});

test("`trimContentStart()` handles list items", () => {
    const input = doc(ul(0, p(text("  Item 1"))), ul(1, p(text("  Nested item"))));
    const expected = doc(ul(0, p(text("Item 1"))), ul(1, p(text("  Nested item"))));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` removes spaces in list item at start", () => {
    const input = doc(ul(0, p(text("  "))), ul(0, p(text("Item 1"))));
    const expected = doc(ul(0, p()), ul(0, p(text("Item 1"))));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles marks on leading text", () => {
    const input = doc(p(text("  ", [bold]), text("Hello world")));
    const expected = doc(p(text("Hello world")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles inline nodes at start", () => {
    const input = doc(p(text("  "), br, text("Hello")));
    const expected = doc(p(br, text("Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles mentions at start", () => {
    const accountId = generateId<AccountId>();
    const input = doc(p(text("  "), mention(accountId), text(" Hello")));
    const expected = doc(p(mention(accountId), text(" Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles complex nested structure", () => {
    const input = doc(
        p(text("  ")),
        quoteBlock(ul(0, p(text("  List in quote"))), p(text("Quote"))),
        p(text("Last")),
    );
    const expected = doc(
        quoteBlock(ul(0, p(text("List in quote"))), p(text("Quote"))),
        p(text("Last")),
    );
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` preserves middle and end spaces", () => {
    const input = doc(p(text("  Hello   world  ")));
    const expected = doc(p(text("Hello   world  ")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles tabs and newlines", () => {
    const input = doc(p(text("  \t\nHello")));
    const expected = doc(p(text("Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` with mixed marks preserves non-empty marked text", () => {
    const input = doc(p(text("  "), text("Hello", [bold, italic]), text(" world")));
    const expected = doc(p(text("Hello", [bold, italic]), text(" world")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` with mixed marks preserves non-empty marked text", () => {
    const input = doc(p(text("Hello "), text("world", [bold, italic]), text("  ")));
    const expected = doc(p(text("Hello "), text("world", [bold, italic])));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles ordered list items", () => {
    const input = doc(ol(0, p(text("  First"))), ol(0, p(text("  Second"))));
    const expected = doc(ol(0, p(text("First"))), ol(0, p(text("  Second"))));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles ordered list items", () => {
    const input = doc(ol(0, p(text("First  "))), ol(0, p(text("Second  "))));
    const expected = doc(ol(0, p(text("First  "))), ol(0, p(text("Second"))));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` preserves leading spaces in code block", () => {
    {
        const input = doc(codeBlock(codeLine(text("  code"))), p(text("text")));
        // Code block is preserved as-is, including its spaces
        expect(trimContentStart(input)).toBe(input);
    }

    {
        const input = doc(codeBlock(codeLine(), codeLine(text("  code"))), p(text("text")));
        // Code block is preserved as-is, including its spaces
        expect(trimContentStart(input)).toBe(input);
    }
});

test("`trimContentEnd()` removes trailing spaces from code block", () => {
    {
        const input = doc(p(text("text")), codeBlock(codeLine(text("code  "))));
        const expected = doc(p(text("text")), codeBlock(codeLine(text("code"))));
        expect(trimContentEnd(input)).toEqual(expected);
    }

    {
        const input = doc(p(text("text")), codeBlock(codeLine(text("code  ")), codeLine()));
        const expected = doc(p(text("text")), codeBlock(codeLine(text("code"))));
        expect(trimContentEnd(input)).toEqual(expected);
    }
});

test("`trimContentStart()` handles deeply nested empty paragraphs", () => {
    const input = doc(quoteBlock(ul(0, p(text("  "))), ul(1, p())), p(text("Content")));
    const expected = doc(quoteBlock(ul(0, p()), ul(1, p())), p(text("Content")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles deeply nested empty paragraphs", () => {
    const input = doc(p(text("Content")), quoteBlock(ul(0, p(text("text"))), ul(1, p(text("  ")))));
    const expected = doc(p(text("Content")), quoteBlock(ul(0, p(text("text"))), ul(1, p())));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles paragraph with only a break node", () => {
    const input = doc(p(br));
    // A paragraph with just a break should be preserved
    expect(trimContentEnd(input)).toEqual(input);
});

test("`trimContentStart()` handles paragraph with only a break node", () => {
    const input = doc(p(br));
    // A paragraph with just a break should be preserved
    expect(trimContentStart(input)).toEqual(input);
});

test("`trimContentEnd()` correctly handles mixed content nodes", () => {
    const accountId = generateId<AccountId>();
    const input = doc(p(text("Hello")), p(br, text("  ")), p(mention(accountId), text("  ")));
    const expected = doc(p(text("Hello")), p(br, text("  ")), p(mention(accountId)));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` correctly handles mixed content nodes", () => {
    const accountId = generateId<AccountId>();
    const input = doc(p(text("  "), mention(accountId)), p(text("  "), br), p(text("Hello")));
    const expected = doc(p(mention(accountId)), p(text("  "), br), p(text("Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles single character text node", () => {
    const input = doc(p(text("a ")));
    const expected = doc(p(text("a")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles single character text node", () => {
    const input = doc(p(text(" a")));
    const expected = doc(p(text("a")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` preserves empty non-paragraph nodes", () => {
    // Empty quote blocks should be preserved
    const input = doc(quoteBlock(), p(text("  ")));
    const expected = doc(quoteBlock());
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` preserves empty non-paragraph nodes", () => {
    // Empty quote blocks should be preserved
    const input = doc(p(text("  ")), quoteBlock());
    const expected = doc(quoteBlock());
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles deeply nested structure with multiple empty paragraphs", () => {
    const input = doc(
        quoteBlock(p(text("Quote")), ul(0, p(text("Item")), p(text("  "))), p()),
        p(text("  ")),
    );
    const expected = doc(quoteBlock(p(text("Quote")), ul(0, p(text("Item")))));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles deeply nested structure with multiple empty paragraphs", () => {
    const input = doc(
        p(text("  ")),
        quoteBlock(p(), ul(0, p(text("  ")), p(text("Item"))), p(text("Quote"))),
    );
    const expected = doc(quoteBlock(ul(0, p(text("Item"))), p(text("Quote"))));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles alternating empty and non-empty paragraphs", () => {
    const input = doc(
        p(text("First")),
        p(text("  ")),
        p(text("Second")),
        p(text("  ")),
        p(text("  ")),
    );
    const expected = doc(p(text("First")), p(text("  ")), p(text("Second")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles alternating empty and non-empty paragraphs", () => {
    const input = doc(
        p(text("  ")),
        p(text("  ")),
        p(text("First")),
        p(text("  ")),
        p(text("Second")),
    );
    const expected = doc(p(text("First")), p(text("  ")), p(text("Second")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles list item with multiple paragraphs where last is empty", () => {
    const input = ul(0, p(text("First paragraph")), p(text("Second paragraph")), p(text("  ")));
    const expected = ul(0, p(text("First paragraph")), p(text("Second paragraph")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles list item with multiple paragraphs where first is empty", () => {
    const input = ul(0, p(text("  ")), p(text("First paragraph")), p(text("Second paragraph")));
    const expected = ul(0, p(text("First paragraph")), p(text("Second paragraph")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContent()` handles content that needs both start and end trimming", () => {
    const input = doc(p(text("  ")), p(text("  Hello  ")), p(text("  World  ")), p(text("  ")));
    const expected = doc(p(text("Hello  ")), p(text("  World")));
    expect(trimContent(input)).toEqual(expected);
});

test("`trimContentFragment()` handles fragment operations correctly", () => {
    const fragment = Fragment.from([p(text("  Hello")), p(text("World  "))]);
    const trimmedStart = trimContentFragmentStart(fragment);
    const trimmedEnd = trimContentFragmentEnd(fragment);
    const trimmedBoth = trimContentFragment(fragment);

    expect(trimmedStart).toEqual(Fragment.from([p(text("Hello")), p(text("World  "))]));
    expect(trimmedEnd).toEqual(Fragment.from([p(text("  Hello")), p(text("World"))]));
    expect(trimmedBoth).toEqual(Fragment.from([p(text("Hello")), p(text("World"))]));
});
