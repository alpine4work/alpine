/* eslint-disable cyberworlds/string-quotes */

import {convertApiContentToProperQuotes} from "~/server/agents/internal/convert_api_content_to_proper_quotes.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

function testConvertApiContentToProperQuotes(input: ApiContent, expected: ApiContent) {
    const result = convertApiContentToProperQuotes(input);
    expect(result).toEqual(expected);
}

test("converts double quotes to proper curly quotes", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: 'He said "Hello world"'}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "He said \u201CHello world\u201D"}],
                },
            ],
        },
    );
});

test("converts single quotes to proper curly quotes", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "It's a 'beautiful' day"}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "It\u2019s a \u2018beautiful\u2019 day"}],
                },
            ],
        },
    );
});

test("handles quotes after whitespace as opening quotes", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: 'Start "quote after space'}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Start \u201Cquote after space"}],
                },
            ],
        },
    );
});

test("handles quotes after tab as opening quotes", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: 'Start\t"quote after tab'}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Start\t\u201Cquote after tab"}],
                },
            ],
        },
    );
});

test("handles quotes after newline as opening quotes", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: 'Start\n"quote after newline'}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Start\n\u201Cquote after newline"}],
                },
            ],
        },
    );
});

test("handles quotes at beginning of text as opening quotes", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: '"Quote at start'}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "\u201CQuote at start"}],
                },
            ],
        },
    );
});

test("handles single quotes at beginning of text as opening quotes", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "'Quote at start"}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "\u2018Quote at start"}],
                },
            ],
        },
    );
});

test("handles mixed single and double quotes", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: `He said "I can't believe it's 'already' done"`},
                    ],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "He said \u201CI can\u2019t believe it\u2019s \u2018already\u2019 done\u201D",
                        },
                    ],
                },
            ],
        },
    );
});

test("handles multiple paragraphs", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: 'First "paragraph"'}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Second 'paragraph'"}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "First \u201Cparagraph\u201D"}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Second \u2018paragraph\u2019"}],
                },
            ],
        },
    );
});

test("handles quotes in different inline elements", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: 'Before "quote'},
                        {type: "Text", text: " middle"},
                        {type: "Text", text: ' end" after'},
                    ],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Before \u201Cquote"},
                        {type: "Text", text: " middle"},
                        {type: "Text", text: " end\u201D after"},
                    ],
                },
            ],
        },
    );
});

test("handles empty text elements", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: ""},
                        {type: "Text", text: '"Hello"'},
                    ],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: ""},
                        {type: "Text", text: "\u201CHello\u201D"},
                    ],
                },
            ],
        },
    );
});

test("handles empty text elements with single quote", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: ""},
                        {type: "Text", text: "'Hello'"},
                    ],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: ""},
                        {type: "Text", text: "\u2018Hello\u2019"},
                    ],
                },
            ],
        },
    );
});

test("handles text with no quotes unchanged", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "No quotes here"}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "No quotes here"}],
                },
            ],
        },
    );
});

test("handles non-text inline elements unchanged", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: 'Before "quote"'},
                        {type: "Break"},
                        {type: "Text", text: "After 'quote'"},
                    ],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Before \u201Cquote\u201D"},
                        {type: "Break"},
                        {type: "Text", text: "After \u2018quote\u2019"},
                    ],
                },
            ],
        },
    );
});

test("handles complex nested structure", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: 'Chapter "One"'}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "It was a 'dark and stormy' night."}],
                },
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: 'He whispered "quietly"'}],
                        },
                    ],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: "Chapter \u201COne\u201D"}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "It was a \u2018dark and stormy\u2019 night."}],
                },
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "He whispered \u201Cquietly\u201D"}],
                        },
                    ],
                },
            ],
        },
    );
});

test("handles consecutive quotes correctly", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: '"Hello""World"'}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "\u201CHello\u201D\u201CWorld\u201D"}],
                },
            ],
        },
    );
});

test("handles consecutive single quotes correctly", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "'Hello''World'"}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "\u2018Hello\u2019\u2018World\u2019"}],
                },
            ],
        },
    );
});

test("handles single quote at end of text", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Don't"}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Don\u2019t"}],
                },
            ],
        },
    );
});

test("handles double quote at end of text", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: 'Say "hello"'}],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Say \u201Chello\u201D"}],
                },
            ],
        },
    );
});

test("handles quotes after mention (possessive)", () => {
    const accountId = generateId<AccountId>();

    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: "Caleb",
                        },
                        {type: "Text", text: "'s idea"},
                    ],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: "Caleb",
                        },
                        {type: "Text", text: "\u2019s idea"},
                    ],
                },
            ],
        },
    );
});

test("doesn\u2019t convert quotes to proper quotes in code", () => {
    testConvertApiContentToProperQuotes(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "A "},
                        {type: "Text", text: '"danger"', marks: [{type: "Code"}]},
                        {type: "Text", text: " button variant was added"},
                    ],
                },
            ],
        },
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "A "},
                        {type: "Text", text: '"danger"', marks: [{type: "Code"}]},
                        {type: "Text", text: " button variant was added"},
                    ],
                },
            ],
        },
    );
});
