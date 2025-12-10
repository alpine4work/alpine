import {
    printSearchTextForInlineFragment,
    printSearchTextForInlineNode,
} from "~/server/search/data/index/internal/print_search_text.js";
import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {RenderContentMentionToTextSearchEntity} from "~/shared/content/render_content_mention_to_text.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, DocumentId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

const mockAccountId = generateId<AccountId>();
const mockPrivateDocumentId = generateId<DocumentId>();
const mockPublicDocumentId = generateId<DocumentId>();

const mockGetAccountIfExists = (accountId: AccountId): AccountModelWithoutSpaceData | null => {
    if (accountId === mockAccountId) {
        const account: AccountModelWithoutSpaceData = {
            id: accountId,
            version: 0,
            name: "Test User",
            nameVersion: 0,
            reactionCharacter: null,
            botId: undefined,
            avatar: null,
        };

        return account;
    }
    return null;
};

const mockGetSearchEntityIfExists = (
    entityId: SearchMentionEntityId,
): RenderContentMentionToTextSearchEntity | null => {
    if (entityId === `Document:${mockPrivateDocumentId}`) {
        return {
            isPrivate: true,
        };
    }

    if (entityId === `Document:${mockPublicDocumentId}`) {
        return {
            isPrivate: false,
            title: "Test Public Document",
            getAccountMediaShortName: null,
        };
    }

    return null;
};

const defaultOptions = {
    context: null,
    getAccountIfExists: mockGetAccountIfExists,
    getSearchEntityIfExists: mockGetSearchEntityIfExists,
};

describe("printSearchTextForInlineFragment", () => {
    const testCases = [
        {
            input: {
                fragment: schema.node("paragraph", {}, [schema.text("Hello world")]).content,
                options: defaultOptions,
            },
            expected: "Hello world",
            description: "simple text node",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [
                    schema.text("Hello", [schema.mark("bold")]),
                    schema.text(" world"),
                ]).content,
                options: defaultOptions,
            },
            expected: "**Hello** world",
            description: "bold text with plain text",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [
                    schema.text("Hello", [schema.mark("italic")]),
                    schema.text(" world"),
                ]).content,
                options: defaultOptions,
            },
            expected: "*Hello* world",
            description: "italic text with plain text",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [
                    schema.text("Hello", [schema.mark("code")]),
                    schema.text(" world"),
                ]).content,
                options: defaultOptions,
            },
            expected: "`Hello` world",
            description: "code text with plain text",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [
                    schema.text("Hello", [schema.mark("strike")]),
                    schema.text(" world"),
                ]).content,
                options: defaultOptions,
            },
            expected: "~~Hello~~ world",
            description: "strikethrough text with plain text",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [
                    schema.text("Link text", [schema.mark("link", {url: "https://example.com"})]),
                ]).content,
                options: defaultOptions,
            },
            expected: "Link text",
            description: "link mark should be removed",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [
                    schema.text("Comment text", [
                        schema.mark("comment", {commentThreadId: "comment-1"}),
                    ]),
                ]).content,
                options: defaultOptions,
            },
            expected: "Comment text",
            description: "comment mark should be removed",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [
                    schema.text("Highlighted text", [schema.mark("highlight", {color: "yellow"})]),
                ]).content,
                options: defaultOptions,
            },
            expected: "Highlighted text",
            description: "highlight mark should be removed",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [
                    schema.text("Bold", [schema.mark("bold")]),
                    schema.text("Italic", [schema.mark("italic")]),
                ]).content,
                options: defaultOptions,
            },
            expected: "**Bold***Italic*",
            description: "adjacent text nodes with different marks",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [
                    schema.text("Same", [schema.mark("bold")]),
                    schema.text("Mark", [schema.mark("bold")]),
                ]).content,
                options: defaultOptions,
            },
            expected: "**SameMark**",
            description: "adjacent text nodes with same marks should be merged",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [schema.text("Code", [schema.mark("code")])])
                    .content,
                options: {...defaultOptions, context: "codeBlock" as const},
            },
            expected: "Code",
            description: "all marks removed in code block context",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [schema.text("Bold", [schema.mark("bold")])])
                    .content,
                options: {...defaultOptions, context: "codeBlock" as const},
            },
            expected: "Bold",
            description: "bold mark removed in code block context",
        },
        {
            input: {
                fragment: schema.node("paragraph", {}, [
                    schema.text("Text", [
                        schema.mark("bold"),
                        schema.mark("italic"),
                        schema.mark("link", {url: "https://example.com"}),
                    ]),
                ]).content,
                options: defaultOptions,
            },
            expected: "***Text***",
            description: "multiple marks with link removed",
        },
    ];

    testCases.forEach(({input, expected, description}) => {
        // eslint-disable-next-line jest/valid-title
        test(description, () => {
            expect(printSearchTextForInlineFragment(input.fragment, input.options)).toEqual(
                expected,
            );
        });
    });
});

describe("printSearchTextForInlineNode", () => {
    describe("text nodes", () => {
        const testCases = [
            {
                input: {
                    node: schema.text("Hello world"),
                    options: defaultOptions,
                },
                expected: "Hello world",
                description: "plain text",
            },
            {
                input: {
                    node: schema.text("Bold text", [schema.mark("bold")]),
                    options: defaultOptions,
                },
                expected: "**Bold text**",
                description: "bold text",
            },
            {
                input: {
                    node: schema.text("Italic text", [schema.mark("italic")]),
                    options: defaultOptions,
                },
                expected: "*Italic text*",
                description: "italic text",
            },
            {
                input: {
                    node: schema.text("Strikethrough", [schema.mark("strike")]),
                    options: defaultOptions,
                },
                expected: "~~Strikethrough~~",
                description: "strikethrough text",
            },
            {
                input: {
                    node: schema.text("Code text", [schema.mark("code")]),
                    options: defaultOptions,
                },
                expected: "`Code text`",
                description: "code text",
            },
            {
                input: {
                    node: schema.text("`backticks`", [schema.mark("code")]),
                    options: defaultOptions,
                },
                expected: "`` `backticks` ``",
                description: "code text with backticks",
            },
            {
                input: {
                    node: schema.text("``double``", [schema.mark("code")]),
                    options: defaultOptions,
                },
                expected: "``` ``double`` ```",
                description: "code text with double backticks",
            },
            {
                input: {
                    node: schema.text(" starts with space", [schema.mark("code")]),
                    options: defaultOptions,
                },
                expected: "` starts with space`",
                description: "code text starting with space",
            },
            {
                input: {
                    node: schema.text("ends with space ", [schema.mark("code")]),
                    options: defaultOptions,
                },
                expected: "`ends with space `",
                description: "code text ending with space",
            },
            {
                input: {
                    node: schema.text("Bold and italic", [
                        schema.mark("bold"),
                        schema.mark("italic"),
                    ]),
                    options: defaultOptions,
                },
                expected: "***Bold and italic***",
                description: "text with both bold and italic",
            },
            {
                input: {
                    node: schema.text("Code and bold", [schema.mark("code"), schema.mark("bold")]),
                    options: defaultOptions,
                },
                expected: "**`Code and bold`**",
                description: "text with code and bold - code applied first",
            },
            {
                input: {
                    node: schema.text("Link text", [
                        schema.mark("link", {url: "https://example.com"}),
                    ]),
                    options: defaultOptions,
                },
                expected: "Link text",
                description: "link mark ignored",
            },
            {
                input: {
                    node: schema.text("Comment", [
                        schema.mark("comment", {commentThreadId: "comment-1"}),
                    ]),
                    options: defaultOptions,
                },
                expected: "Comment",
                description: "comment mark ignored",
            },
            {
                input: {
                    node: schema.text("Highlight", [schema.mark("highlight", {color: "yellow"})]),
                    options: defaultOptions,
                },
                expected: "Highlight",
                description: "highlight mark ignored",
            },
        ];

        testCases.forEach(({input, expected, description}) => {
            // eslint-disable-next-line jest/valid-title
            test(description, () => {
                expect(printSearchTextForInlineNode(input.node, input.options)).toEqual(expected);
            });
        });
    });

    describe("break nodes", () => {
        const testCases = [
            {
                input: {
                    node: schema.node("break"),
                    options: defaultOptions,
                },
                expected: "\\\n",
                description: "break in normal context",
            },
            {
                input: {
                    node: schema.node("break"),
                    options: {...defaultOptions, context: "heading" as const},
                },
                expected: "<br/>",
                description: "break in heading context",
            },
            {
                input: {
                    node: schema.node("break"),
                    options: {...defaultOptions, context: "codeBlock" as const},
                },
                expected: "\\\n",
                description: "break in code block context",
            },
        ];

        testCases.forEach(({input, expected, description}) => {
            // eslint-disable-next-line jest/valid-title
            test(description, () => {
                expect(printSearchTextForInlineNode(input.node, input.options)).toEqual(expected);
            });
        });
    });

    describe("mention nodes", () => {
        describe("account mentions", () => {
            const testCases = [
                {
                    input: {
                        node: schema.node("mention", {
                            mention: {
                                type: "Account",
                                accountId: mockAccountId,
                                isShort: false,
                            } as ContentMention,
                        }),
                        options: defaultOptions,
                    },
                    expected: "Test User",
                    description: "existing account full name",
                },
                {
                    input: {
                        node: schema.node("mention", {
                            mention: {
                                type: "Account",
                                accountId: mockAccountId,
                                isShort: true,
                            } as ContentMention,
                        }),
                        options: defaultOptions,
                    },
                    expected: "Test",
                    description: "existing account short name",
                },
                {
                    input: {
                        node: schema.node("mention", {
                            mention: {
                                type: "Account",
                                accountId: generateId<AccountId>(),
                                isShort: false,
                            } as ContentMention,
                        }),
                        options: defaultOptions,
                    },
                    expected: "Unknown",
                    description: "non-existent account full name",
                },
                {
                    input: {
                        node: schema.node("mention", {
                            mention: {
                                type: "Account",
                                accountId: generateId<AccountId>(),
                                isShort: true,
                            } as ContentMention,
                        }),
                        options: defaultOptions,
                    },
                    expected: "Unknown",
                    description: "non-existent account short name",
                },
            ];

            testCases.forEach(({input, expected, description}) => {
                // eslint-disable-next-line jest/valid-title
                test(description, () => {
                    expect(printSearchTextForInlineNode(input.node, input.options)).toEqual(
                        expected,
                    );
                });
            });
        });

        describe("search entity mentions", () => {
            const testCases = [
                {
                    input: {
                        node: schema.node("mention", {
                            mention: {
                                type: "SearchEntity",
                                entityId:
                                    `Document:${mockPublicDocumentId}` as SearchMentionEntityId,
                            } as ContentMention,
                        }),
                        options: defaultOptions,
                    },
                    expected: "Test Public Document",
                    description: "public document entity",
                },
                {
                    input: {
                        node: schema.node("mention", {
                            mention: {
                                type: "SearchEntity",
                                entityId:
                                    `Document:${mockPrivateDocumentId}` as SearchMentionEntityId,
                            } as ContentMention,
                        }),
                        options: defaultOptions,
                    },
                    expected: "Private document",
                    description: "private document entity",
                },
                {
                    input: {
                        node: schema.node("mention", {
                            mention: {
                                type: "SearchEntity",
                                entityId:
                                    `Document:${generateId<DocumentId>()}` as SearchMentionEntityId,
                            } as ContentMention,
                        }),
                        options: defaultOptions,
                    },
                    expected: "Unknown document",
                    description: "non-existent document entity",
                },
                {
                    input: {
                        node: schema.node("mention", {
                            mention: {
                                type: "SearchEntity",
                                entityId:
                                    `Post:${generateId<DocumentId>()}` as SearchMentionEntityId,
                            } as ContentMention,
                        }),
                        options: defaultOptions,
                    },
                    expected: "Unknown post",
                    description: "non-existent post entity",
                },
                {
                    input: {
                        node: schema.node("mention", {
                            mention: {
                                type: "SearchEntity",
                                entityId:
                                    `Task:${generateId<DocumentId>()}` as SearchMentionEntityId,
                            } as ContentMention,
                        }),
                        options: defaultOptions,
                    },
                    expected: "Unknown task",
                    description: "non-existent task entity",
                },
            ];

            testCases.forEach(({input, expected, description}) => {
                // eslint-disable-next-line jest/valid-title
                test(description, () => {
                    expect(printSearchTextForInlineNode(input.node, input.options)).toEqual(
                        expected,
                    );
                });
            });
        });

        describe("mention integration in fragments", () => {
            const testCases = [
                {
                    input: {
                        fragment: schema.node("paragraph", {}, [
                            schema.text("Hello "),
                            schema.node("mention", {
                                mention: {
                                    type: "Account",
                                    accountId: mockAccountId,
                                    isShort: false,
                                } as ContentMention,
                            }),
                            schema.text(", welcome to the team!"),
                        ]).content,
                        options: defaultOptions,
                    },
                    expected: "Hello Test User, welcome to the team!",
                    description: "account mention in paragraph",
                },
                {
                    input: {
                        fragment: schema.node("paragraph", {}, [
                            schema.text("Check out "),
                            schema.node("mention", {
                                mention: {
                                    type: "SearchEntity",
                                    entityId:
                                        `Document:${mockPublicDocumentId}` as SearchMentionEntityId,
                                } as ContentMention,
                            }),
                            schema.text(" for more details."),
                        ]).content,
                        options: defaultOptions,
                    },
                    expected: "Check out Test Public Document for more details.",
                    description: "document mention in paragraph",
                },
                {
                    input: {
                        fragment: schema.node("paragraph", {}, [
                            schema.text("Meeting with "),
                            schema.node("mention", {
                                mention: {
                                    type: "Account",
                                    accountId: mockAccountId,
                                    isShort: true,
                                } as ContentMention,
                            }),
                            schema.text(" about "),
                            schema.node("mention", {
                                mention: {
                                    type: "SearchEntity",
                                    entityId:
                                        `Document:${mockPrivateDocumentId}` as SearchMentionEntityId,
                                } as ContentMention,
                            }),
                            schema.text("."),
                        ]).content,
                        options: defaultOptions,
                    },
                    expected: "Meeting with Test about Private document.",
                    description: "multiple mentions in paragraph",
                },
                {
                    input: {
                        fragment: schema.node("paragraph", {}, [
                            schema.text("Unknown user "),
                            schema.node("mention", {
                                mention: {
                                    type: "Account",
                                    accountId: generateId<AccountId>(),
                                    isShort: false,
                                } as ContentMention,
                            }),
                            schema.text(" shared "),
                            schema.node("mention", {
                                mention: {
                                    type: "SearchEntity",
                                    entityId:
                                        `Document:${generateId<DocumentId>()}` as SearchMentionEntityId,
                                } as ContentMention,
                            }),
                            schema.text("."),
                        ]).content,
                        options: defaultOptions,
                    },
                    expected: "Unknown user Unknown shared Unknown document.",
                    description: "non-existent mentions in paragraph",
                },
            ];

            testCases.forEach(({input, expected, description}) => {
                // eslint-disable-next-line jest/valid-title
                test(description, () => {
                    expect(printSearchTextForInlineFragment(input.fragment, input.options)).toEqual(
                        expected,
                    );
                });
            });
        });
    });
});

describe("markdown escaping", () => {
    describe("escapeMarkdown scenarios", () => {
        const testCases = [
            {
                input: "Regular text",
                expected: "Regular text",
                description: "no special characters",
            },
            {
                input: "Text with *asterisks*",
                expected: "Text with \\*asterisks\\*",
                description: "asterisks escaped",
            },
            {
                input: "Text with _underscores_",
                expected: "Text with \\_underscores\\_",
                description: "underscores escaped",
            },
            {
                input: "Text with `backticks`",
                expected: "Text with \\`backticks\\`",
                description: "backticks escaped",
            },
            {
                input: "Text with ~~tildes~~",
                expected: "Text with \\~\\~tildes\\~\\~",
                description: "tildes escaped",
            },
            {
                input: "Text with \\backslashes\\",
                expected: "Text with \\\\backslashes\\\\",
                description: "backslashes escaped",
            },
            {
                input: "> Quote block",
                expected: "\\> Quote block",
                description: "quote block marker escaped",
            },
            {
                input: "+ List item",
                expected: "\\+ List item",
                description: "plus list marker escaped",
            },
            {
                input: "- List item",
                expected: "\\- List item",
                description: "dash list marker escaped",
            },
            {
                input: "# Header",
                expected: "\\# Header",
                description: "header marker escaped",
            },
            {
                input: "1. Numbered list",
                expected: "1\\. Numbered list",
                description: "numbered list marker escaped",
            },
            {
                input: "[Link text](url)",
                expected: "[Link text\\](url)",
                description: "link bracket escaped",
            },
            {
                input: "<em>HTML tag</em>",
                expected: "\\<em>HTML tag\\</em>",
                description: "HTML tag escaped",
            },
            {
                input: "&amp; entity",
                expected: "\\&amp; entity",
                description: "HTML entity escaped",
            },
            {
                input: "    Code block indent",
                expected: "    Code block indent",
                description: "code block indentation not escaped",
            },
        ];

        testCases.forEach(({input, expected, description}) => {
            // eslint-disable-next-line jest/valid-title
            test(description, () => {
                const textNode = schema.text(input);
                const result = printSearchTextForInlineNode(textNode, defaultOptions);
                expect(result).toEqual(expected);
            });
        });
    });

    describe("escapeMarkdownInCode scenarios", () => {
        const testCases = [
            {
                input: "Regular code",
                expected: "`Regular code`",
                description: "no special characters in code",
            },
            {
                input: "Code with <em>tags</em>",
                expected: "`Code with \\<em>tags\\</em>`",
                description: "HTML tags escaped in code",
            },
            {
                input: "Code with </em> closing tag",
                expected: "`Code with \\</em> closing tag`",
                description: "closing HTML tag escaped in code",
            },
            {
                input: "Code with <em> opening tag",
                expected: "`Code with \\<em> opening tag`",
                description: "opening HTML tag escaped in code",
            },
        ];

        testCases.forEach(({input, expected, description}) => {
            // eslint-disable-next-line jest/valid-title
            test(description, () => {
                const textNode = schema.text(input, [schema.mark("code")]);
                const result = printSearchTextForInlineNode(textNode, defaultOptions);
                expect(result).toEqual(expected);
            });
        });
    });

    describe("context-specific escaping", () => {
        const testCases = [
            {
                input: {
                    node: schema.text("*Bold text*"),
                    options: {...defaultOptions, context: "codeBlock" as const},
                },
                expected: "*Bold text*",
                description: "markdown escaped in code block context",
            },
            {
                input: {
                    node: schema.text("<em>HTML</em>"),
                    options: {...defaultOptions, context: "codeBlock" as const},
                },
                expected: "\\<em>HTML\\</em>",
                description: "HTML tags escaped in code block context",
            },
        ];

        testCases.forEach(({input, expected, description}) => {
            // eslint-disable-next-line jest/valid-title
            test(description, () => {
                expect(printSearchTextForInlineNode(input.node, input.options)).toEqual(expected);
            });
        });
    });
});
