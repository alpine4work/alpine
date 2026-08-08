import {visitAndProduceApiContent} from "~/shared/api/content/visit_and_produce_api_content.open_source.js";
import {
    ApiContent,
    ApiContentInlineElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";

describe("visitAndProduceApiContent", () => {
    test("returns same object when no changes made (immer optimization)", () => {
        const content: ApiContent = {
            elements: [{type: "Paragraph", elements: [{type: "Text", text: "Hello"}]}],
        };

        const result = visitAndProduceApiContent(content, {});

        expect(result).toEqual(content);
        // Immer returns the same object when no changes are made (optimization)
        expect(result).toBe(content);
    });

    test("modifies text content", () => {
        const content: ApiContent = {
            elements: [{type: "Paragraph", elements: [{type: "Text", text: "hello"}]}],
        };

        const result = visitAndProduceApiContent(content, {
            visitInlineElement: element => {
                if (element.type === "Text") {
                    element.text = element.text.toUpperCase();
                }
            },
        });

        expect(result.elements[0]).toMatchObject({
            type: "Paragraph",
            elements: [{type: "Text", text: "HELLO"}],
        });
        // Original should be unchanged
        expect(content.elements[0]).toMatchObject({
            type: "Paragraph",
            elements: [{type: "Text", text: "hello"}],
        });
    });

    test("replaces inline elements in context array", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "See "},
                        {
                            type: "Text",
                            text: "link",
                            marks: [{type: "Link", url: "doc.md"}],
                        },
                        {type: "Text", text: " for details"},
                    ],
                },
            ],
        };

        const result = visitAndProduceApiContent(content, {
            visitInlineElement: (element, context) => {
                if (element.type === "Text" && element.marks?.some(m => m.type === "Link")) {
                    // Replace link with mention
                    (context.elements as Array<ApiContentInlineElement>)[context.index] = {
                        type: "Mention",
                        reference: {type: "Document", id: "doc123" as any},
                    };
                }
            },
        });

        expect(result.elements[0]).toMatchObject({
            type: "Paragraph",
            elements: [
                {type: "Text", text: "See "},
                {type: "Mention", reference: {type: "Document", id: "doc123"}},
                {type: "Text", text: " for details"},
            ],
        });
    });

    test("modifies heading levels", () => {
        const content: ApiContent = {
            elements: [
                {type: "Heading", level: 2, elements: [{type: "Text", text: "Section"}]},
                {type: "Heading", level: 3, elements: [{type: "Text", text: "Subsection"}]},
            ],
        };

        const result = visitAndProduceApiContent(content, {
            visitBlockElement: element => {
                if (element.type === "Heading" && element.level > 1) {
                    element.level = element.level - 1;
                }
            },
        });

        expect(result.elements).toMatchObject([
            {type: "Heading", level: 1, elements: [{type: "Text", text: "Section"}]},
            {type: "Heading", level: 2, elements: [{type: "Text", text: "Subsection"}]},
        ]);
    });

    test("modifies marks on inline elements", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "styled",
                            marks: [{type: "Bold"}],
                        },
                    ],
                },
            ],
        };

        const result = visitAndProduceApiContent(content, {
            visitMark: mark => {
                if (mark.type === "Bold") {
                    // Change Bold to Italic
                    (mark as any).type = "Italic";
                }
            },
        });

        expect(result.elements[0]).toMatchObject({
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: "styled",
                    marks: [{type: "Italic"}],
                },
            ],
        });
    });

    test("handles nested list items", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "item"}]},
                            ],
                        },
                    ],
                },
            ],
        };

        const result = visitAndProduceApiContent(content, {
            visitInlineElement: element => {
                if (element.type === "Text") {
                    element.text = element.text.toUpperCase();
                }
            },
        });

        expect(result.elements[0]).toMatchObject({
            type: "UnorderedList",
            items: [
                {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "ITEM"}]}],
                },
            ],
        });
    });

    test("handles table cells", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Table",
                    width: 100,
                    columns: [{width: 100}],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "cell"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        const result = visitAndProduceApiContent(content, {
            visitInlineElement: element => {
                if (element.type === "Text") {
                    element.text = element.text.toUpperCase();
                }
            },
        });

        expect(result.elements[0]).toMatchObject({
            type: "Table",
            rows: [
                {
                    cells: [
                        {
                            elements: [
                                {type: "Paragraph", elements: [{type: "Text", text: "CELL"}]},
                            ],
                        },
                    ],
                },
            ],
        });
    });

    test("handles quote blocks", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Quote",
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "quoted"}]}],
                },
            ],
        };

        const result = visitAndProduceApiContent(content, {
            visitInlineElement: element => {
                if (element.type === "Text") {
                    element.text = element.text.toUpperCase();
                }
            },
        });

        expect(result.elements[0]).toMatchObject({
            type: "Quote",
            elements: [{type: "Paragraph", elements: [{type: "Text", text: "QUOTED"}]}],
        });
    });

    test("transforms multiple elements in one pass", () => {
        const content: ApiContent = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Link: ", marks: [{type: "Link", url: "a.md"}]},
                        {type: "Text", text: "Another: ", marks: [{type: "Link", url: "b.md"}]},
                    ],
                },
            ],
        };

        const replacedUrls: Array<string> = [];
        const result = visitAndProduceApiContent(content, {
            visitInlineElement: (element, context) => {
                if (element.type === "Text" && element.marks) {
                    const linkMark = element.marks.find(m => m.type === "Link");
                    if (linkMark && "url" in linkMark && linkMark.url.endsWith(".md")) {
                        replacedUrls.push(linkMark.url);
                        (context.elements as Array<ApiContentInlineElement>)[context.index] = {
                            type: "Mention",
                            reference: {type: "Document", id: linkMark.url as any},
                        };
                    }
                }
            },
        });

        expect(replacedUrls).toEqual(["a.md", "b.md"]);
        expect(result.elements[0]).toMatchObject({
            type: "Paragraph",
            elements: [
                {type: "Mention", reference: {type: "Document", id: "a.md"}},
                {type: "Mention", reference: {type: "Document", id: "b.md"}},
            ],
        });
    });
});
