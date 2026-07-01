import {Fragment} from "prosemirror-model";
import {ContentMention} from "~/shared/content/content_mention.js";
import {createContentBuilder} from "~/shared/content/create_content_builder.js";
import {MessageContentProsemirrorSchema as schema} from "~/shared/content/message_content_schema.js";
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

const {
    doc,
    paragraph,
    text,
    codeBlock,
    codeBlockLine,
    quoteBlock,
    unorderedListItem,
    orderedListItem,
    break: breakNode,
    mention,
    bold,
    italic,
} = createContentBuilder(schema);

function accountMention(accountId: AccountId) {
    return mention(cast<ContentMention>({type: "Account", accountId, isShort: false}));
}

test("`trimContentEnd()` removes trailing spaces from simple paragraph", () => {
    const input = doc(paragraph(text("Hello world   ")));
    const expected = doc(paragraph(text("Hello world")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` preserves content without trailing spaces", () => {
    const input = doc(paragraph(text("Hello world")));
    expect(trimContentEnd(input)).toBe(input); // Should return same instance
});

test("`trimContentEnd()` removes trailing empty paragraph", () => {
    const input = doc(paragraph(text("Hello")), paragraph(text("   ")));
    const expected = doc(paragraph(text("Hello")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` removes multiple trailing empty paragraphs", () => {
    const input = doc(paragraph(text("Hello")), paragraph(text("   ")), paragraph());
    const expected = doc(paragraph(text("Hello")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles nested quote blocks", () => {
    const input = quoteBlock(paragraph(text("Quote")), paragraph(text("   ")));
    const expected = quoteBlock(paragraph(text("Quote")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` removes trailing space from code block", () => {
    const input = doc(codeBlock("text", codeBlockLine(text("  function() {  "))));
    const expected = doc(codeBlock("text", codeBlockLine(text("  function() {"))));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles list items", () => {
    const input = doc(unorderedListItem(0, paragraph(text("Item 1  "))), unorderedListItem(1, paragraph(text("Nested item  "))));
    const expected = doc(unorderedListItem(0, paragraph(text("Item 1  "))), unorderedListItem(1, paragraph(text("Nested item"))));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` removes trailing spaces in list item at end", () => {
    const input = doc(unorderedListItem(0, paragraph(text("Item 1"))), unorderedListItem(0, paragraph(text("  "))));
    const expected = doc(unorderedListItem(0, paragraph(text("Item 1"))), unorderedListItem(0, paragraph()));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles marks on trailing text", () => {
    const input = doc(paragraph(text("Hello "), text("world  ", [bold()])));
    const expected = doc(paragraph(text("Hello "), text("world", [bold()])));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles inline nodes at end", () => {
    const input = doc(paragraph(text("Hello"), breakNode(), text("  ")));
    const expected = doc(paragraph(text("Hello"), breakNode()));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles mentions at end", () => {
    const accountId = generateId<AccountId>();
    const input = doc(paragraph(text("Hello "), accountMention(accountId), text("  ")));
    const expected = doc(paragraph(text("Hello "), accountMention(accountId)));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles empty document", () => {
    const input = doc(paragraph());
    expect(trimContentEnd(input)).toEqual(input);
});

test("`trimContentEnd()` handles document with only spaces", () => {
    const input = doc(paragraph(text("   ")));
    const expected = doc(paragraph());
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles complex nested structure", () => {
    const input = doc(
        paragraph(text("First")),
        quoteBlock(paragraph(text("Quote")), unorderedListItem(0, paragraph(text("List in quote  ")))),
        paragraph(text("  ")),
    );
    const expected = doc(
        paragraph(text("First")),
        quoteBlock(paragraph(text("Quote")), unorderedListItem(0, paragraph(text("List in quote")))),
    );
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` preserves middle spaces", () => {
    const input = doc(paragraph(text("Hello   world  ")));
    const expected = doc(paragraph(text("Hello   world")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles tabs and newlines", () => {
    const input = doc(paragraph(text("Hello\t\n  ")));
    const expected = doc(paragraph(text("Hello")));
    expect(trimContentEnd(input)).toEqual(expected);
});

// Tests for trimContentStart()
test("`trimContentStart()` removes leading spaces from simple paragraph", () => {
    const input = doc(paragraph(text("   Hello world")));
    const expected = doc(paragraph(text("Hello world")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` preserves content without leading spaces", () => {
    const input = doc(paragraph(text("Hello world")));
    expect(trimContentStart(input)).toBe(input); // Should return same instance
});

test("`trimContentStart()` removes leading empty paragraph", () => {
    const input = doc(paragraph(text("   ")), paragraph(text("Hello")));
    const expected = doc(paragraph(text("Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` removes multiple leading empty paragraphs", () => {
    const input = doc(paragraph(), paragraph(text("   ")), paragraph(text("Hello")));
    const expected = doc(paragraph(text("Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles nested quote blocks", () => {
    const input = quoteBlock(paragraph(text("   ")), paragraph(text("Quote")));
    const expected = quoteBlock(paragraph(text("Quote")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` preserves code block spaces", () => {
    const input = doc(codeBlock("text", codeBlockLine(text("  function() {"))));
    // Code blocks should preserve all spaces
    expect(trimContentStart(input)).toBe(input);
});

test("`trimContentStart()` handles list items", () => {
    const input = doc(unorderedListItem(0, paragraph(text("  Item 1"))), unorderedListItem(1, paragraph(text("  Nested item"))));
    const expected = doc(unorderedListItem(0, paragraph(text("Item 1"))), unorderedListItem(1, paragraph(text("  Nested item"))));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` removes spaces in list item at start", () => {
    const input = doc(unorderedListItem(0, paragraph(text("  "))), unorderedListItem(0, paragraph(text("Item 1"))));
    const expected = doc(unorderedListItem(0, paragraph()), unorderedListItem(0, paragraph(text("Item 1"))));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles marks on leading text", () => {
    const input = doc(paragraph(text("  ", [bold()]), text("Hello world")));
    const expected = doc(paragraph(text("Hello world")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles inline nodes at start", () => {
    const input = doc(paragraph(text("  "), breakNode(), text("Hello")));
    const expected = doc(paragraph(breakNode(), text("Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles mentions at start", () => {
    const accountId = generateId<AccountId>();
    const input = doc(paragraph(text("  "), accountMention(accountId), text(" Hello")));
    const expected = doc(paragraph(accountMention(accountId), text(" Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles complex nested structure", () => {
    const input = doc(
        paragraph(text("  ")),
        quoteBlock(unorderedListItem(0, paragraph(text("  List in quote"))), paragraph(text("Quote"))),
        paragraph(text("Last")),
    );
    const expected = doc(
        quoteBlock(unorderedListItem(0, paragraph(text("List in quote"))), paragraph(text("Quote"))),
        paragraph(text("Last")),
    );
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` preserves middle and end spaces", () => {
    const input = doc(paragraph(text("  Hello   world  ")));
    const expected = doc(paragraph(text("Hello   world  ")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles tabs and newlines", () => {
    const input = doc(paragraph(text("  \t\nHello")));
    const expected = doc(paragraph(text("Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` with mixed marks preserves non-empty marked text", () => {
    const input = doc(paragraph(text("  "), text("Hello", [bold(), italic()]), text(" world")));
    const expected = doc(paragraph(text("Hello", [bold(), italic()]), text(" world")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` with mixed marks preserves non-empty marked text", () => {
    const input = doc(paragraph(text("Hello "), text("world", [bold(), italic()]), text("  ")));
    const expected = doc(paragraph(text("Hello "), text("world", [bold(), italic()])));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles ordered list items", () => {
    const input = doc(orderedListItem(0, paragraph(text("  First"))), orderedListItem(0, paragraph(text("  Second"))));
    const expected = doc(orderedListItem(0, paragraph(text("First"))), orderedListItem(0, paragraph(text("  Second"))));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles ordered list items", () => {
    const input = doc(orderedListItem(0, paragraph(text("First  "))), orderedListItem(0, paragraph(text("Second  "))));
    const expected = doc(orderedListItem(0, paragraph(text("First  "))), orderedListItem(0, paragraph(text("Second"))));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` preserves leading spaces in code block", () => {
    {
        const input = doc(codeBlock("text", codeBlockLine(text("  code"))), paragraph(text("text")));
        // Code block is preserved as-is, including its spaces
        expect(trimContentStart(input)).toBe(input);
    }

    {
        const input = doc(codeBlock("text", codeBlockLine(), codeBlockLine(text("  code"))), paragraph(text("text")));
        // Code block is preserved as-is, including its spaces
        expect(trimContentStart(input)).toBe(input);
    }
});

test("`trimContentEnd()` removes trailing spaces from code block", () => {
    {
        const input = doc(paragraph(text("text")), codeBlock("text", codeBlockLine(text("code  "))));
        const expected = doc(paragraph(text("text")), codeBlock("text", codeBlockLine(text("code"))));
        expect(trimContentEnd(input)).toEqual(expected);
    }

    {
        const input = doc(paragraph(text("text")), codeBlock("text", codeBlockLine(text("code  ")), codeBlockLine()));
        const expected = doc(paragraph(text("text")), codeBlock("text", codeBlockLine(text("code"))));
        expect(trimContentEnd(input)).toEqual(expected);
    }
});

test("`trimContentStart()` handles deeply nested empty paragraphs", () => {
    const input = doc(quoteBlock(unorderedListItem(0, paragraph(text("  "))), unorderedListItem(1, paragraph())), paragraph(text("Content")));
    const expected = doc(quoteBlock(unorderedListItem(0, paragraph()), unorderedListItem(1, paragraph())), paragraph(text("Content")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles deeply nested empty paragraphs", () => {
    const input = doc(paragraph(text("Content")), quoteBlock(unorderedListItem(0, paragraph(text("text"))), unorderedListItem(1, paragraph(text("  ")))));
    const expected = doc(paragraph(text("Content")), quoteBlock(unorderedListItem(0, paragraph(text("text"))), unorderedListItem(1, paragraph())));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles paragraph with only a break node", () => {
    const input = doc(paragraph(breakNode()));
    // A paragraph with just a break should be preserved
    expect(trimContentEnd(input)).toEqual(input);
});

test("`trimContentStart()` handles paragraph with only a break node", () => {
    const input = doc(paragraph(breakNode()));
    // A paragraph with just a break should be preserved
    expect(trimContentStart(input)).toEqual(input);
});

test("`trimContentEnd()` correctly handles mixed content nodes", () => {
    const accountId = generateId<AccountId>();
    const input = doc(paragraph(text("Hello")), paragraph(breakNode(), text("  ")), paragraph(accountMention(accountId), text("  ")));
    const expected = doc(paragraph(text("Hello")), paragraph(breakNode(), text("  ")), paragraph(accountMention(accountId)));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` correctly handles mixed content nodes", () => {
    const accountId = generateId<AccountId>();
    const input = doc(paragraph(text("  "), accountMention(accountId)), paragraph(text("  "), breakNode()), paragraph(text("Hello")));
    const expected = doc(paragraph(accountMention(accountId)), paragraph(text("  "), breakNode()), paragraph(text("Hello")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles single character text node", () => {
    const input = doc(paragraph(text("a ")));
    const expected = doc(paragraph(text("a")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles single character text node", () => {
    const input = doc(paragraph(text(" a")));
    const expected = doc(paragraph(text("a")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` preserves empty non-paragraph nodes", () => {
    // Empty quote blocks should be preserved
    const input = doc(quoteBlock(), paragraph(text("  ")));
    const expected = doc(quoteBlock());
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` preserves empty non-paragraph nodes", () => {
    // Empty quote blocks should be preserved
    const input = doc(paragraph(text("  ")), quoteBlock());
    const expected = doc(quoteBlock());
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles deeply nested structure with multiple empty paragraphs", () => {
    const input = doc(
        quoteBlock(paragraph(text("Quote")), unorderedListItem(0, paragraph(text("Item")), paragraph(text("  "))), paragraph()),
        paragraph(text("  ")),
    );
    const expected = doc(quoteBlock(paragraph(text("Quote")), unorderedListItem(0, paragraph(text("Item")))));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles deeply nested structure with multiple empty paragraphs", () => {
    const input = doc(
        paragraph(text("  ")),
        quoteBlock(paragraph(), unorderedListItem(0, paragraph(text("  ")), paragraph(text("Item"))), paragraph(text("Quote"))),
    );
    const expected = doc(quoteBlock(unorderedListItem(0, paragraph(text("Item"))), paragraph(text("Quote"))));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles alternating empty and non-empty paragraphs", () => {
    const input = doc(
        paragraph(text("First")),
        paragraph(text("  ")),
        paragraph(text("Second")),
        paragraph(text("  ")),
        paragraph(text("  ")),
    );
    const expected = doc(paragraph(text("First")), paragraph(text("  ")), paragraph(text("Second")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles alternating empty and non-empty paragraphs", () => {
    const input = doc(
        paragraph(text("  ")),
        paragraph(text("  ")),
        paragraph(text("First")),
        paragraph(text("  ")),
        paragraph(text("Second")),
    );
    const expected = doc(paragraph(text("First")), paragraph(text("  ")), paragraph(text("Second")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles list item with multiple paragraphs where last is empty", () => {
    const input = unorderedListItem(0, paragraph(text("First paragraph")), paragraph(text("Second paragraph")), paragraph(text("  ")));
    const expected = unorderedListItem(0, paragraph(text("First paragraph")), paragraph(text("Second paragraph")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles list item with multiple paragraphs where first is empty", () => {
    const input = unorderedListItem(0, paragraph(text("  ")), paragraph(text("First paragraph")), paragraph(text("Second paragraph")));
    const expected = unorderedListItem(0, paragraph(text("First paragraph")), paragraph(text("Second paragraph")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContent()` handles content that needs both start and end trimming", () => {
    const input = doc(paragraph(text("  ")), paragraph(text("  Hello  ")), paragraph(text("  World  ")), paragraph(text("  ")));
    const expected = doc(paragraph(text("Hello  ")), paragraph(text("  World")));
    expect(trimContent(input)).toEqual(expected);
});

test("`trimContentFragment()` handles fragment operations correctly", () => {
    const fragment = Fragment.from([paragraph(text("  Hello")), paragraph(text("World  "))]);
    const trimmedStart = trimContentFragmentStart(fragment);
    const trimmedEnd = trimContentFragmentEnd(fragment);
    const trimmedBoth = trimContentFragment(fragment);

    expect(trimmedStart).toEqual(Fragment.from([paragraph(text("Hello")), paragraph(text("World  "))]));
    expect(trimmedEnd).toEqual(Fragment.from([paragraph(text("  Hello")), paragraph(text("World"))]));
    expect(trimmedBoth).toEqual(Fragment.from([paragraph(text("Hello")), paragraph(text("World"))]));
});
