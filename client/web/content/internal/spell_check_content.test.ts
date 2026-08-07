import {
    actuallySpellCheckContent,
    createSpellCheckContent,
} from "~/client/web/content/internal/spell_check_content.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;
const spaceId = generateId<SpaceId>();

const mispelledWordSuggestions = [
    {
        text: "misspelled",
        kind: "replace",
    },
    {
        text: "dispelled",
        kind: "replace",
    },
];

// We aren't testing the actual spell check logic here - we'll trust the library is
// doing that. We want to test that we are calling the library, and we get the data
// in the correct format.

describe("actuallySpellCheckContent()", () => {
    test("returns empty array for empty text", async () => {
        const input = "";
        const expected: Array<any> = [];

        const result = await actuallySpellCheckContent(input);
        expect(result).toEqual(expected);
    });

    test("returns empty array for correct text", async () => {
        const input = "This is correct text.";
        const expected: Array<any> = [];

        const result = await actuallySpellCheckContent(input);
        expect(result).toEqual(expected);
    });

    test("detects misspelled words", async () => {
        const input = "This is mispellled text.";
        const expected = {
            index: 8,
            length: 10,
            kind: "spelling",
            category: "spelling",
            key: expect.any(Array),
            suggestions: mispelledWordSuggestions,
        };

        const results = await actuallySpellCheckContent(input);

        expect(results).toHaveLength(1);
        const result = assertExists(results[0]);
        expect(result).toEqual(expected);
    });

    test("detects grammatical errors", async () => {
        const input = "I went to the the store.";
        const expected = {
            index: 10,
            length: 7,
            kind: "repetition",
            category: "grammar",
            key: expect.any(Array),
            suggestions: [
                {
                    text: "the",
                    kind: "replace",
                },
            ],
        };

        const results = await actuallySpellCheckContent(input);

        expect(results.length).toBeGreaterThanOrEqual(1);
        const result = assertExists(results[0]);
        expect(result).toEqual(expected);
    });

    test("handles whitespace-only text", async () => {
        const input = "   \n\t  ";
        const expected: Array<any> = [];

        const result = await actuallySpellCheckContent(input);
        expect(result).toEqual(expected);
    });

    test("handles multiple errors in same text", async () => {
        const input = "This haas mispellled words.";
        const expectedFirstLint = {
            index: 5,
            length: 4,
            kind: "spelling",
            category: "spelling",
            key: expect.any(Array),
            suggestions: [
                {
                    text: "has",
                    kind: "replace",
                },
                {
                    text: "hays",
                    kind: "replace",
                },
                {
                    text: "Haas",
                    kind: "replace",
                },
            ],
        };
        const expectedSecondLint = {
            index: 10,
            length: 10,
            kind: "spelling",
            category: "spelling",
            key: expect.any(Array),
            suggestions: mispelledWordSuggestions,
        };

        const results = await actuallySpellCheckContent(input);

        expect(results.length).toBeGreaterThanOrEqual(2);

        // First lint: "hsa"
        const firstResult = assertExists(results[0]);
        expect(firstResult).toEqual(expectedFirstLint);

        // Second lint: "mispellled"
        const secondResult = assertExists(results[1]);
        expect(secondResult).toEqual(expectedSecondLint);
    });
});

describe("createSpellCheckContent()", () => {
    // TODO(#spell-check): test mentions once we better support them
    // TODO(#spell-check): test that we skip codeblocks
    const spellCheckContent = createSpellCheckContent({
        spaceId,
        getContentReferences: () => emptyContentReferences,
    });

    test("processes simple text node", async () => {
        const input = schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("This is mispellled text.")]),
        ]);
        const expected = {
            from: 9, // Position of "mispellled" in ProseMirror doc
            to: 19, // End position of "mispellled"
            kind: "spelling",
            category: "spelling",
            key: expect.any(Array),
            suggestions: mispelledWordSuggestions,
        };

        const results = await spellCheckContent(input);

        expect(results).toHaveLength(1);
        const result = assertExists(results[0]);
        expect(result).toEqual(expected);
    });

    test("returns empty array for correct text", async () => {
        const input = schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("This is correct text.")]),
        ]);
        const expected: Array<any> = [];

        const result = await spellCheckContent(input);
        expect(result).toEqual(expected);
    });

    test("processes multiple paragraphs", async () => {
        const input = schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("This is correct text.")]),
            schema.node("paragraph", {}, [schema.text("This is mispellled text.")]),
        ]);
        const expected = {
            from: 32, // Position of "mispellled" in second paragraph
            to: 42, // End position of "mispellled"
            kind: "spelling",
            category: "spelling",
            key: expect.any(Array),
            suggestions: mispelledWordSuggestions,
        };

        const results = await spellCheckContent(input);

        expect(results).toHaveLength(1);
        const result = assertExists(results[0]);
        expect(result).toEqual(expected);
    });

    test("handles text with line breaks", async () => {
        const input = schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("First line"),
                schema.node("break"),
                schema.text("Second line with mispellled word."),
            ]),
        ]);
        const expected = {
            from: 29, // Position of "mispellled" after break
            to: 39, // End position of "mispellled"
            kind: "spelling",
            category: "spelling",
            key: expect.any(Array),
            suggestions: mispelledWordSuggestions,
        };

        const results = await spellCheckContent(input);

        expect(results).toHaveLength(1);
        const result = assertExists(results[0]);
        expect(result).toEqual(expected);
    });

    test("skips textblocks with only whitespace", async () => {
        const input = schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("   \n\t  ")]),
        ]);
        const expected: Array<any> = [];

        const result = await spellCheckContent(input);
        expect(result).toEqual(expected);
    });

    test("maps lint positions correctly", async () => {
        const input = schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("This is mispellled text.")]),
        ]);

        const results = await spellCheckContent(input);

        if (results.length > 0) {
            const result = assertExists(results[0]);
            expect(result.from).toBeGreaterThan(0);
            expect(result.to).toBeGreaterThan(result.from);
            expect(result.to).toBeLessThanOrEqual(input.nodeSize);
        }
    });

    test("ignores lints that cross non-text nodes", async () => {
        const input = schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Wor"),
                schema.node("mention", {
                    mention: {type: "SearchEntity", entityId: `Account:${generateId()}`},
                }),
                schema.text("ds"),
            ]),
        ]);
        const mentionStart = 4; // After "Wor"
        const mentionEnd = mentionStart + 1; // Mention node size
        const expected: Array<any> = [];

        const results = await spellCheckContent(input);

        // The lint should not cross the mention node
        const crossingLints = results.filter(lint => {
            return lint.from < mentionEnd && lint.to > mentionStart;
        });

        expect(crossingLints).toEqual(expected);
    });

    test("processes list items correctly", async () => {
        const input = schema.node("doc", {}, [
            schema.node("unorderedListItem", {}, [
                schema.node("paragraph", {}, [schema.text("This is mispellled text in a list.")]),
            ]),
        ]);
        const expected = {
            from: 10, // Position of "mispellled" in list item
            to: 20, // End position of "mispellled"
            kind: "spelling",
            category: "spelling",
            key: expect.any(Array),
            suggestions: mispelledWordSuggestions,
        };

        const results = await spellCheckContent(input);

        expect(results).toHaveLength(1);
        const result = assertExists(results[0]);
        expect(result).toEqual(expected);
    });

    test("processes quote blocks correctly", async () => {
        const input = schema.node("doc", {}, [
            schema.node("quoteBlock", {}, [
                schema.node("paragraph", {}, [schema.text("This is mispellled text in a quote.")]),
            ]),
        ]);
        const expected = {
            from: 10, // Position of "mispellled" in quote block
            to: 20, // End position of "mispellled"
            kind: "spelling",
            category: "spelling",
            key: expect.any(Array),
            suggestions: mispelledWordSuggestions,
        };

        const results = await spellCheckContent(input);

        expect(results).toHaveLength(1);
        const result = assertExists(results[0]);
        expect(result).toEqual(expected);
    });

    test("creates unique keys for each lint", async () => {
        const input = schema.node("doc", {}, [
            schema.node("paragraph", {}, [schema.text("This hase multiple mispellled words.")]),
        ]);

        const results = await spellCheckContent(input);

        if (results.length > 1) {
            const keys = results.map(lint => lint.key);
            const uniqueKeys = new Set(keys);
            const expectedUniqueCount = keys.length;
            expect(uniqueKeys.size).toEqual(expectedUniqueCount);
        }
    });
});
