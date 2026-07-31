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
    const input = doc(paragraph("Hello world   "));
    const expected = doc(paragraph("Hello world"));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` preserves content without trailing spaces", () => {
    const input = doc(paragraph("Hello world"));
    expect(trimContentEnd(input)).toBe(input); // Should return same instance
});

test("`trimContentEnd()` removes trailing empty paragraph", () => {
    const input = doc(paragraph("Hello"), paragraph("   "));
    const expected = doc(paragraph("Hello"));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` removes multiple trailing empty paragraphs", () => {
    const input = doc(paragraph("Hello"), paragraph("   "), paragraph());
    const expected = doc(paragraph("Hello"));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles nested quote blocks", () => {
    const input = quoteBlock(paragraph("Quote"), paragraph("   "));
    const expected = quoteBlock(paragraph("Quote"));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` removes trailing space from code block", () => {
    const input = doc(codeBlock("text", codeBlockLine("  function() {  ")));
    const expected = doc(codeBlock("text", codeBlockLine("  function() {")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles list items", () => {
    const input = doc(
        unorderedListItem(0, paragraph("Item 1  ")),
        unorderedListItem(1, paragraph("Nested item  ")),
    );
    const expected = doc(
        unorderedListItem(0, paragraph("Item 1  ")),
        unorderedListItem(1, paragraph("Nested item")),
    );
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` removes trailing spaces in list item at end", () => {
    const input = doc(
        unorderedListItem(0, paragraph("Item 1")),
        unorderedListItem(0, paragraph("  ")),
    );
    const expected = doc(
        unorderedListItem(0, paragraph("Item 1")),
        unorderedListItem(0, paragraph()),
    );
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles marks on trailing text", () => {
    const input = doc(paragraph("Hello ", bold("world  ")));
    const expected = doc(paragraph("Hello ", bold("world")));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles inline nodes at end", () => {
    const input = doc(paragraph("Hello", breakNode(), "  "));
    const expected = doc(paragraph("Hello", breakNode()));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles mentions at end", () => {
    const accountId = generateId<AccountId>();
    const input = doc(paragraph("Hello ", accountMention(accountId), "  "));
    const expected = doc(paragraph("Hello ", accountMention(accountId)));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles empty document", () => {
    const input = doc(paragraph());
    expect(trimContentEnd(input)).toEqual(input);
});

test("`trimContentEnd()` handles document with only spaces", () => {
    const input = doc(paragraph("   "));
    const expected = doc(paragraph());
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles complex nested structure", () => {
    const input = doc(
        paragraph("First"),
        quoteBlock(paragraph("Quote"), unorderedListItem(0, paragraph("List in quote  "))),
        paragraph("  "),
    );
    const expected = doc(
        paragraph("First"),
        quoteBlock(paragraph("Quote"), unorderedListItem(0, paragraph("List in quote"))),
    );
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` preserves middle spaces", () => {
    const input = doc(paragraph("Hello   world  "));
    const expected = doc(paragraph("Hello   world"));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentEnd()` handles tabs and newlines", () => {
    const input = doc(paragraph("Hello\t\n  "));
    const expected = doc(paragraph("Hello"));
    expect(trimContentEnd(input)).toEqual(expected);
});

// Tests for trimContentStart()
test("`trimContentStart()` removes leading spaces from simple paragraph", () => {
    const input = doc(paragraph("   Hello world"));
    const expected = doc(paragraph("Hello world"));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` preserves content without leading spaces", () => {
    const input = doc(paragraph("Hello world"));
    expect(trimContentStart(input)).toBe(input); // Should return same instance
});

test("`trimContentStart()` removes leading empty paragraph", () => {
    const input = doc(paragraph("   "), paragraph("Hello"));
    const expected = doc(paragraph("Hello"));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` removes multiple leading empty paragraphs", () => {
    const input = doc(paragraph(), paragraph("   "), paragraph("Hello"));
    const expected = doc(paragraph("Hello"));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles nested quote blocks", () => {
    const input = quoteBlock(paragraph("   "), paragraph("Quote"));
    const expected = quoteBlock(paragraph("Quote"));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` preserves code block spaces", () => {
    const input = doc(codeBlock("text", codeBlockLine("  function() {")));
    // Code blocks should preserve all spaces
    expect(trimContentStart(input)).toBe(input);
});

test("`trimContentStart()` handles list items", () => {
    const input = doc(
        unorderedListItem(0, paragraph("  Item 1")),
        unorderedListItem(1, paragraph("  Nested item")),
    );
    const expected = doc(
        unorderedListItem(0, paragraph("Item 1")),
        unorderedListItem(1, paragraph("  Nested item")),
    );
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` removes spaces in list item at start", () => {
    const input = doc(
        unorderedListItem(0, paragraph("  ")),
        unorderedListItem(0, paragraph("Item 1")),
    );
    const expected = doc(
        unorderedListItem(0, paragraph()),
        unorderedListItem(0, paragraph("Item 1")),
    );
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles marks on leading text", () => {
    const input = doc(paragraph(bold("  "), "Hello world"));
    const expected = doc(paragraph("Hello world"));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles inline nodes at start", () => {
    const input = doc(paragraph("  ", breakNode(), "Hello"));
    const expected = doc(paragraph(breakNode(), "Hello"));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles mentions at start", () => {
    const accountId = generateId<AccountId>();
    const input = doc(paragraph("  ", accountMention(accountId), " Hello"));
    const expected = doc(paragraph(accountMention(accountId), " Hello"));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles complex nested structure", () => {
    const input = doc(
        paragraph("  "),
        quoteBlock(unorderedListItem(0, paragraph("  List in quote")), paragraph("Quote")),
        paragraph("Last"),
    );
    const expected = doc(
        quoteBlock(unorderedListItem(0, paragraph("List in quote")), paragraph("Quote")),
        paragraph("Last"),
    );
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` preserves middle and end spaces", () => {
    const input = doc(paragraph("  Hello   world  "));
    const expected = doc(paragraph("Hello   world  "));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` handles tabs and newlines", () => {
    const input = doc(paragraph("  \t\nHello"));
    const expected = doc(paragraph("Hello"));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentStart()` with mixed marks preserves non-empty marked text", () => {
    const input = doc(paragraph("  ", italic(bold("Hello")), " world"));
    const expected = doc(paragraph(italic(bold("Hello")), " world"));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` with mixed marks preserves non-empty marked text", () => {
    const input = doc(paragraph("Hello ", italic(bold("world")), "  "));
    const expected = doc(paragraph("Hello ", italic(bold("world"))));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles ordered list items", () => {
    const input = doc(
        orderedListItem(0, paragraph("  First")),
        orderedListItem(0, paragraph("  Second")),
    );
    const expected = doc(
        orderedListItem(0, paragraph("First")),
        orderedListItem(0, paragraph("  Second")),
    );
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles ordered list items", () => {
    const input = doc(
        orderedListItem(0, paragraph("First  ")),
        orderedListItem(0, paragraph("Second  ")),
    );
    const expected = doc(
        orderedListItem(0, paragraph("First  ")),
        orderedListItem(0, paragraph("Second")),
    );
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` preserves leading spaces in code block", () => {
    {
        const input = doc(codeBlock("text", codeBlockLine("  code")), paragraph("text"));
        // Code block is preserved as-is, including its spaces
        expect(trimContentStart(input)).toBe(input);
    }

    {
        const input = doc(
            codeBlock("text", codeBlockLine(), codeBlockLine("  code")),
            paragraph("text"),
        );
        // Code block is preserved as-is, including its spaces
        expect(trimContentStart(input)).toBe(input);
    }
});

test("`trimContentEnd()` removes trailing spaces from code block", () => {
    {
        const input = doc(paragraph("text"), codeBlock("text", codeBlockLine("code  ")));
        const expected = doc(paragraph("text"), codeBlock("text", codeBlockLine("code")));
        expect(trimContentEnd(input)).toEqual(expected);
    }

    {
        const input = doc(
            paragraph("text"),
            codeBlock("text", codeBlockLine("code  "), codeBlockLine()),
        );
        const expected = doc(paragraph("text"), codeBlock("text", codeBlockLine("code")));
        expect(trimContentEnd(input)).toEqual(expected);
    }
});

test("`trimContentStart()` handles deeply nested empty paragraphs", () => {
    const input = doc(
        quoteBlock(unorderedListItem(0, paragraph("  ")), unorderedListItem(1, paragraph())),
        paragraph("Content"),
    );
    const expected = doc(
        quoteBlock(unorderedListItem(0, paragraph()), unorderedListItem(1, paragraph())),
        paragraph("Content"),
    );
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles deeply nested empty paragraphs", () => {
    const input = doc(
        paragraph("Content"),
        quoteBlock(unorderedListItem(0, paragraph("text")), unorderedListItem(1, paragraph("  "))),
    );
    const expected = doc(
        paragraph("Content"),
        quoteBlock(unorderedListItem(0, paragraph("text")), unorderedListItem(1, paragraph())),
    );
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
    const input = doc(
        paragraph("Hello"),
        paragraph(breakNode(), "  "),
        paragraph(accountMention(accountId), "  "),
    );
    const expected = doc(
        paragraph("Hello"),
        paragraph(breakNode(), "  "),
        paragraph(accountMention(accountId)),
    );
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` correctly handles mixed content nodes", () => {
    const accountId = generateId<AccountId>();
    const input = doc(
        paragraph("  ", accountMention(accountId)),
        paragraph("  ", breakNode()),
        paragraph("Hello"),
    );
    const expected = doc(
        paragraph(accountMention(accountId)),
        paragraph("  ", breakNode()),
        paragraph("Hello"),
    );
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles single character text node", () => {
    const input = doc(paragraph("a "));
    const expected = doc(paragraph("a"));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles single character text node", () => {
    const input = doc(paragraph(" a"));
    const expected = doc(paragraph("a"));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` preserves empty non-paragraph nodes", () => {
    // Empty quote blocks should be preserved
    const input = doc(quoteBlock(), paragraph("  "));
    const expected = doc(quoteBlock());
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` preserves empty non-paragraph nodes", () => {
    // Empty quote blocks should be preserved
    const input = doc(paragraph("  "), quoteBlock());
    const expected = doc(quoteBlock());
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles deeply nested structure with multiple empty paragraphs", () => {
    const input = doc(
        quoteBlock(
            paragraph("Quote"),
            unorderedListItem(0, paragraph("Item"), paragraph("  ")),
            paragraph(),
        ),
        paragraph("  "),
    );
    const expected = doc(quoteBlock(paragraph("Quote"), unorderedListItem(0, paragraph("Item"))));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles deeply nested structure with multiple empty paragraphs", () => {
    const input = doc(
        paragraph("  "),
        quoteBlock(
            paragraph(),
            unorderedListItem(0, paragraph("  "), paragraph("Item")),
            paragraph("Quote"),
        ),
    );
    const expected = doc(quoteBlock(unorderedListItem(0, paragraph("Item")), paragraph("Quote")));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles alternating empty and non-empty paragraphs", () => {
    const input = doc(
        paragraph("First"),
        paragraph("  "),
        paragraph("Second"),
        paragraph("  "),
        paragraph("  "),
    );
    const expected = doc(paragraph("First"), paragraph("  "), paragraph("Second"));
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles alternating empty and non-empty paragraphs", () => {
    const input = doc(
        paragraph("  "),
        paragraph("  "),
        paragraph("First"),
        paragraph("  "),
        paragraph("Second"),
    );
    const expected = doc(paragraph("First"), paragraph("  "), paragraph("Second"));
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContentEnd()` handles list item with multiple paragraphs where last is empty", () => {
    const input = unorderedListItem(
        0,
        paragraph("First paragraph"),
        paragraph("Second paragraph"),
        paragraph("  "),
    );
    const expected = unorderedListItem(
        0,
        paragraph("First paragraph"),
        paragraph("Second paragraph"),
    );
    expect(trimContentEnd(input)).toEqual(expected);
});

test("`trimContentStart()` handles list item with multiple paragraphs where first is empty", () => {
    const input = unorderedListItem(
        0,
        paragraph("  "),
        paragraph("First paragraph"),
        paragraph("Second paragraph"),
    );
    const expected = unorderedListItem(
        0,
        paragraph("First paragraph"),
        paragraph("Second paragraph"),
    );
    expect(trimContentStart(input)).toEqual(expected);
});

test("`trimContent()` handles content that needs both start and end trimming", () => {
    const input = doc(
        paragraph("  "),
        paragraph("  Hello  "),
        paragraph("  World  "),
        paragraph("  "),
    );
    const expected = doc(paragraph("Hello  "), paragraph("  World"));
    expect(trimContent(input)).toEqual(expected);
});

test("`trimContentFragment()` handles fragment operations correctly", () => {
    const fragment = Fragment.from([paragraph("  Hello"), paragraph("World  ")]);
    const trimmedStart = trimContentFragmentStart(fragment);
    const trimmedEnd = trimContentFragmentEnd(fragment);
    const trimmedBoth = trimContentFragment(fragment);

    expect(trimmedStart).toEqual(Fragment.from([paragraph("Hello"), paragraph("World  ")]));
    expect(trimmedEnd).toEqual(Fragment.from([paragraph("  Hello"), paragraph("World")]));
    expect(trimmedBoth).toEqual(Fragment.from([paragraph("Hello"), paragraph("World")]));
});
