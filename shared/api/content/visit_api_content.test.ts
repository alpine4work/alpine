import {visitApiContent} from "~/shared/api/content/visit_api_content.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";

describe("visitApiContent", () => {
    test("visits all block elements", () => {
        const content: ApiContent = {
            elements: [
                {type: "Paragraph", elements: [{type: "Text", text: "Hello"}]},
                {type: "Divider"},
                {type: "Paragraph", elements: [{type: "Text", text: "World"}]},
            ],
        };

        const visitedTypes: Array<string> = [];
        visitApiContent(content, {
            visitBlockElement: element => {
                visitedTypes.push(element.type);
            },
        });

        expect(visitedTypes).toEqual(["Paragraph", "Divider", "Paragraph"]);
    });

    test("visits all inline elements", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hello"},
                        {type: "Break"},
                        {type: "Text", text: "World"},
                    ],
                },
            ],
        };

        const visitedTypes: Array<string> = [];
        visitApiContent(content, {
            visitInlineElement: element => {
                visitedTypes.push(element.type);
            },
        });

        expect(visitedTypes).toEqual(["Text", "Break", "Text"]);
    });

    test("visits inline elements in headings", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: "Title"}],
                },
            ],
        };

        const texts: Array<string> = [];
        visitApiContent(content, {
            visitInlineElement: element => {
                if (element.type === "Text") {
                    texts.push(element.text);
                }
            },
        });

        expect(texts).toEqual(["Title"]);
    });

    test("visits nested list items", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Item 1"}]},
                            ],
                        },
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Item 2"}]},
                            ],
                        },
                    ],
                },
            ],
        };

        const texts: Array<string> = [];
        visitApiContent(content, {
            visitInlineElement: element => {
                if (element.type === "Text") {
                    texts.push(element.text);
                }
            },
        });

        expect(texts).toEqual(["Item 1", "Item 2"]);
    });

    test("visits quote block elements", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {type: "Paragraph", elements: [{type: "Text", text: "Quoted text"}]},
                    ],
                },
            ],
        };

        const texts: Array<string> = [];
        visitApiContent(content, {
            visitInlineElement: element => {
                if (element.type === "Text") {
                    texts.push(element.text);
                }
            },
        });

        expect(texts).toEqual(["Quoted text"]);
    });

    test("visits table cells", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Table",
                    width: 200,
                    columns: [{width: 100}, {width: 100}],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Cell 2"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        const texts: Array<string> = [];
        visitApiContent(content, {
            visitInlineElement: element => {
                if (element.type === "Text") {
                    texts.push(element.text);
                }
            },
        });

        expect(texts).toEqual(["Cell 1", "Cell 2"]);
    });

    test("visits code block lines", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Code",
                    language: "typescript",
                    lines: [
                        {elements: [{type: "Text", text: "const x = 1;"}]},
                        {elements: [{type: "Text", text: "const y = 2;"}]},
                    ],
                },
            ],
        };

        const texts: Array<string> = [];
        visitApiContent(content, {
            visitInlineElement: element => {
                if (element.type === "Text") {
                    texts.push(element.text);
                }
            },
        });

        expect(texts).toEqual(["const x = 1;", "const y = 2;"]);
    });

    test("visits marks on inline elements", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "Bold text",
                            marks: [{type: "Bold"}, {type: "Italic"}],
                        },
                    ],
                },
            ],
        };

        const markTypes: Array<string> = [];
        visitApiContent(content, {
            visitMark: mark => {
                markTypes.push(mark.type);
            },
        });

        expect(markTypes).toEqual(["Bold", "Italic"]);
    });

    test("provides correct context to visitors", () => {
        const content: ApiContent = {
            elements: [
                {type: "Paragraph", elements: [{type: "Text", text: "First"}]},
                {type: "Paragraph", elements: [{type: "Text", text: "Second"}]},
            ],
        };

        const contexts: Array<{index: number; length: number}> = [];
        visitApiContent(content, {
            visitBlockElement: (_, context) => {
                contexts.push({index: context.index, length: context.elements.length});
            },
        });

        expect(contexts).toEqual([
            {index: 0, length: 2},
            {index: 1, length: 2},
        ]);
    });

    test("visits mention elements", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "See "},
                        {type: "Mention", reference: {type: "Document", id: "doc123" as any}},
                        {type: "Text", text: " for details"},
                    ],
                },
            ],
        };

        const elementTypes: Array<string> = [];
        visitApiContent(content, {
            visitInlineElement: element => {
                elementTypes.push(element.type);
            },
        });

        expect(elementTypes).toEqual(["Text", "Mention", "Text"]);
    });

    test("visits checklist items", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "CheckList",
                    items: [
                        {
                            checked: true,
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Done"}]},
                            ],
                        },
                        {
                            checked: false,
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Todo"}]},
                            ],
                        },
                    ],
                },
            ],
        };

        const texts: Array<string> = [];
        visitApiContent(content, {
            visitInlineElement: element => {
                if (element.type === "Text") {
                    texts.push(element.text);
                }
            },
        });

        expect(texts).toEqual(["Done", "Todo"]);
    });

    test("visits ordered list items", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "First"}]},
                            ],
                        },
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "Second"}]},
                            ],
                        },
                    ],
                },
            ],
        };

        const texts: Array<string> = [];
        visitApiContent(content, {
            visitInlineElement: element => {
                if (element.type === "Text") {
                    texts.push(element.text);
                }
            },
        });

        expect(texts).toEqual(["First", "Second"]);
    });
});
