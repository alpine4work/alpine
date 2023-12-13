import {parseSearchContent} from "~/server/search/data/internal/parse_search_content.js";

// NOTE(calebmer): Most of the test coverage for `parseSearchContent()` is in
// `chunk_search_content.test.ts` since we check that search content
// parsing/printing is symmetrical.

test("properly highlights content with `<em>` HTML tags", () => {
    expect(
        parseSearchContent(
            `The <em>word</em> <em>hella</em> was a slang term used mostly in the San Francisco Bay Area and other parts of California to mean "very". Having toured in the Bay Area, Stefani borrowed the term to describe her mood. Stefani wanted to use the <em>word</em> dance in a chorus, so she decided to end each line of "<em>Hella</em> Good"'s chorus with the phrase "keep on dancing".`,
            {shouldParseEmphasisHtmlTagAsHighlight: true},
        ).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "The "},
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "word",
                    },
                    {type: "text", text: " "},
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "hella",
                    },
                    {
                        type: "text",
                        text: ' was a slang term used mostly in the San Francisco Bay Area and other parts of California to mean "very". Having toured in the Bay Area, Stefani borrowed the term to describe her mood. Stefani wanted to use the ',
                    },
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "word",
                    },
                    {
                        type: "text",
                        text: ' dance in a chorus, so she decided to end each line of "',
                    },
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "Hella",
                    },
                    {type: "text", text: ' Good"\'s chorus with the phrase "keep on dancing".'},
                ],
            },
        ],
    });

    expect(
        parseSearchContent(
            `This (<em>Supercalifragilisticexpialidocious</em>) document has \\<strong>html\\</strong> characters in it to test the highlight renderer. It has a unique word like <em>Supercalifragilisticexpialidocious</em> to make it easier to find when searching.`,
            {shouldParseEmphasisHtmlTagAsHighlight: true},
        ).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "This ("},
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "Supercalifragilisticexpialidocious",
                    },
                    {
                        type: "text",
                        text: ") document has <strong>html</strong> characters in it to test the highlight renderer. It has a unique word like ",
                    },
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "Supercalifragilisticexpialidocious",
                    },
                    {type: "text", text: " to make it easier to find when searching."},
                ],
            },
        ],
    });

    expect(
        parseSearchContent(
            `This (<em>Supercalifragilisticexpialidocious</em>) document has <strong>html</strong> characters in it to test the highlight renderer. It has a unique word like <em>Supercalifragilisticexpialidocious</em> to make it easier to find when searching.`,
            {shouldParseEmphasisHtmlTagAsHighlight: true},
        ).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "This ("},
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "Supercalifragilisticexpialidocious",
                    },
                    {
                        type: "text",
                        text: ") document has <strong>html</strong> characters in it to test the highlight renderer. It has a unique word like ",
                    },
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "Supercalifragilisticexpialidocious",
                    },
                    {type: "text", text: " to make it easier to find when searching."},
                ],
            },
        ],
    });
});
