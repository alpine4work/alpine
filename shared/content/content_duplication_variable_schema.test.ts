/* eslint-disable jest-dom/prefer-to-have-text-content */

import {Mark, Node as ProseMirrorNode} from "prosemirror-model";
import {
    ContentDuplicationVariableSchema,
    ContentDuplicationVariableValues,
    ContentDuplicationVariableValuesProperty,
    applyContentDuplicationVariableValues,
    applyContentDuplicationVariableValuesToText,
    decodeContentDuplicationVariableSchemaFromUrl,
    encodeContentDuplicationVariableSchemaForUrl,
    extractContentDuplicationVariableSchema,
} from "~/shared/content/content_duplication_variable_schema.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {HighlightColor} from "~/shared/design/core/highlight_color.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";

function createTestDocument(content: Array<{type: string; content?: unknown; attrs?: unknown}>) {
    return assertDocumentContent(
        DocumentContentProsemirrorSchema.nodeFromJSON({
            type: "doc",
            attrs: {
                accessPolicy: {
                    accountGrantById: new Map(),
                    defaultGrant: null,
                    urlGrant: null,
                },
                hasPresentShortcut: false,
                cover: null,
            },
            content: [{type: "title"}, ...content],
        }),
    );
}

function createTestMessageContent(
    content: Array<{
        type: string;
        content?: unknown;
        attrs?: unknown;
        text?: string;
        marks?: unknown;
    }>,
) {
    return assertMessageContent(
        MessageContentProsemirrorSchema.nodeFromJSON({
            type: "doc",
            content,
        }),
    );
}

function schemaToObject(schema: ContentDuplicationVariableSchema) {
    const result: Record<string, {type: string; markTypes?: Array<string>}> = {};
    for (const [name, prop] of schema) {
        if (prop.type === "Text") {
            result[name] = {
                type: "Text",
                markTypes: prop.marks.map((mark: {type: string}) => mark.type),
            };
        } else {
            result[name] = {type: "Content"};
        }
    }
    return result;
}

describe("extractContentDuplicationSchema", () => {
    test("extracts Text variable from inline text", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{Name}}, welcome!"}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            Name: {type: "Text", markTypes: []},
        });
    });

    test("extracts Content variable when alone in root paragraph", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "{{Description}}"}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            Description: {type: "Content"},
        });
    });

    test("extracts Content variable with trailing whitespace", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "  {{Description}}  "}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            Description: {type: "Content"},
        });
    });

    test("extracts Text variable with code mark from code block", () => {
        const doc = createTestDocument([
            {
                type: "codeBlock",
                attrs: {language: "text"},
                content: [
                    {
                        type: "codeBlockLine",
                        content: [{type: "text", text: "{{command}}"}],
                    },
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            command: {type: "Text", markTypes: ["code"]},
        });
    });

    test("extracts Text variable with inline code mark", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "Run "},
                    {type: "text", text: "{{command}}", marks: [{type: "code"}]},
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            command: {type: "Text", markTypes: ["code"]},
        });
    });

    test("extracts Text variable with bold mark", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "Hello "},
                    {type: "text", text: "{{Name}}", marks: [{type: "bold"}]},
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            Name: {type: "Text", markTypes: ["bold"]},
        });
    });

    test("extracts Text variable with multiple marks", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "Name: "},
                    {
                        type: "text",
                        text: "{{Name}}",
                        marks: [{type: "bold"}, {type: "italic"}],
                    },
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            Name: {type: "Text", markTypes: ["bold", "italic"]},
        });
    });

    test("extracts multiple unique variables", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Dear {{Name}}, your code is {{Code}}."}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            Name: {type: "Text", markTypes: []},
            Code: {type: "Text", markTypes: []},
        });
    });

    test("deduplicates same variable appearing multiple times", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{Name}}, goodbye {{Name}}!"}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schema.size).toBe(1);
        expect(schema.has("Name")).toBe(true);
    });

    test("ignores empty variable names", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{}} world"}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schema.size).toBe(0);
    });

    test("ignores whitespace-only variable names", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{   }} world"}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schema.size).toBe(0);
    });

    test("trims whitespace from variable names", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{  Name  }}!"}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schema.has("Name")).toBe(true);
        expect(schema.size).toBe(1);
    });

    // Edge cases

    test("mixed marks across variable name keeps only common marks", () => {
        // {{Na is bold+italic, me}} is only bold
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "Hello "},
                    {type: "text", text: "{{Na", marks: [{type: "bold"}, {type: "italic"}]},
                    {type: "text", text: "me}}", marks: [{type: "bold"}]},
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            Name: {type: "Text", markTypes: ["bold"]},
        });
    });

    test("mixed marks where no marks are common results in empty marks", () => {
        // {{Na is bold, me}} is italic - no common marks
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "{{Na", marks: [{type: "bold"}]},
                    {type: "text", text: "me}}", marks: [{type: "italic"}]},
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            Name: {type: "Text", markTypes: []},
        });
    });

    test("variable name interrupted by mention is not extracted", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "Hello {{Na"},
                    {type: "break"},
                    {type: "text", text: "me}} world"},
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schema.size).toBe(0);
    });

    test("same variable with different marks in different places uses intersection", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    // First occurrence: bold + italic
                    {type: "text", text: "{{Name}}", marks: [{type: "bold"}, {type: "italic"}]},
                    {type: "text", text: " and "},
                    // Second occurrence: bold only
                    {type: "text", text: "{{Name}}", marks: [{type: "bold"}]},
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        // Only bold is common to both occurrences
        expect(schemaToObject(schema)).toEqual({
            Name: {type: "Text", markTypes: ["bold"]},
        });
    });

    test("same variable as Content in one place and Text in another becomes Text", () => {
        const doc = createTestDocument([
            // First: alone in paragraph (would be Content)
            {
                type: "paragraph",
                content: [{type: "text", text: "{{Name}}"}],
            },
            // Second: inline with other text (Text)
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{Name}}!"}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        // Because one occurrence is inline, it becomes Text
        expect(schemaToObject(schema)).toEqual({
            Name: {type: "Text", markTypes: []},
        });
    });

    test("variable spanning multiple text nodes with same marks", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "{{", marks: [{type: "bold"}]},
                    {type: "text", text: "Name", marks: [{type: "bold"}]},
                    {type: "text", text: "}}", marks: [{type: "bold"}]},
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            Name: {type: "Text", markTypes: ["bold"]},
        });
    });

    test("variable with mark only on name", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "{{"},
                    {type: "text", text: "Name", marks: [{type: "bold"}]},
                    {type: "text", text: "}}"},
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schemaToObject(schema)).toEqual({
            Name: {type: "Text", markTypes: ["bold"]},
        });
    });

    test("variable in nested blockquote is Text not Content", () => {
        const doc = createTestDocument([
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "{{Quote}}"}],
                    },
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        // Not Content because paragraph depth > 0
        expect(schemaToObject(schema)).toEqual({
            Quote: {type: "Text", markTypes: []},
        });
    });

    test("variable in list item is Text not Content", () => {
        const doc = createTestDocument([
            {
                type: "unorderedListItem",
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "{{Item}}"}],
                    },
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        // Not Content because paragraph is nested
        expect(schemaToObject(schema)).toEqual({
            Item: {type: "Text", markTypes: []},
        });
    });

    test("filters out link and comment marks from variables", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "Hello "},
                    {
                        type: "text",
                        text: "{{Name}}",
                        marks: [
                            {type: "bold"},
                            {type: "link", attrs: {url: "https://example.com"}},
                        ],
                    },
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        // Link mark should be filtered out
        expect(schemaToObject(schema)).toEqual({
            Name: {type: "Text", markTypes: ["bold"]},
        });
    });

    test("incomplete variable syntax is not extracted", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "Hello {Name1} and {{Name2 and {{{Name3}}} and {{{{Name4}}}}",
                    },
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schema.size).toBe(0);
    });

    test("single brace does not start variable", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {Name} world"}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schema.size).toBe(0);
    });

    test("unclosed variable is not extracted", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{Name world"}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schema.size).toBe(0);
    });

    test("variable with only one closing brace is not extracted", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{Name} world"}],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        expect(schema.size).toBe(0);
    });

    test("variable name with plain text then space then styled text extracts correct name", () => {
        // {{Hello (plain) + world}} (bold) - space at node boundary is trimmed so variable
        // name is "Helloworld"
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "{{Hello "},
                    {type: "text", text: "world}}", marks: [{type: "bold"}]},
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        // Space at text node boundary is trimmed during extraction
        expect(schemaToObject(schema)).toEqual({
            "Hello world": {type: "Text", markTypes: []},
        });
    });

    test("variable name with plain text then space then styled text (excluding bracket) extracts correct name", () => {
        // {{Hello (plain) + world}} (bold) - space at node boundary is trimmed so variable
        // name is "Helloworld"
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "{{Hello "},
                    {type: "text", text: "world", marks: [{type: "bold"}]},
                    {type: "text", text: "}}"},
                ],
            },
        ]);

        const schema = extractContentDuplicationVariableSchema(doc);

        // Space at text node boundary is trimmed during extraction
        expect(schemaToObject(schema)).toEqual({
            "Hello world": {type: "Text", markTypes: []},
        });
    });
});

describe("applyContentDuplicationValues", () => {
    test("replaces Text variable with plain text", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{Name}}!"}],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            [
                "Name",
                {
                    type: "Text",
                    text: "World",
                    marks: [],
                },
            ],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        expect(result.child(1).textContent).toBe("Hello World!");
    });

    test("replaces Text variable with marks applied", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{Name}}!"}],
            },
        ]);

        const values = new Map<string, ContentDuplicationVariableValuesProperty>([
            [
                "Name",
                {
                    type: "Text",
                    text: "World",
                    marks: [{type: "bold"}],
                },
            ],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        const paragraph = result.child(1);
        expect(paragraph.textContent).toBe("Hello World!");

        // Find the "World" text node and verify it has bold mark
        let foundBold = false;
        paragraph.forEach((node: ProseMirrorNode) => {
            if (node.isText && node.text === "World") {
                foundBold = node.marks.some((m: Mark) => m.type.name === "bold");
            }
        });
        expect(foundBold).toBe(true);
    });

    test("replaces multiple occurrences of same variable", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "{{Name}} and {{Name}}"}],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "Bob", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        expect(result.child(1).textContent).toBe("Bob and Bob");
    });

    test("replaces multiple different variables", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "{{First}} {{Last}}"}],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["First", {type: "Text", text: "John", marks: []}],
            ["Last", {type: "Text", text: "Doe", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        expect(result.child(1).textContent).toBe("John Doe");
    });

    test("replaces Content variable with rich content", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "{{Description}}"}],
            },
        ]);

        const messageContent = createTestMessageContent([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "Hello "},
                    {type: "text", text: "World", marks: [{type: "bold"}]},
                ],
            },
        ]);

        const values = new Map<string, ContentDuplicationVariableValuesProperty>([
            ["Description", {type: "Content", content: messageContent}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        // The paragraph should now contain "Hello World" with World being bold
        const paragraph = result.child(1);
        expect(paragraph.textContent).toBe("Hello World");
    });

    test("empty Text value is a no-op", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{Name}}!"}],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        // Variable should remain unchanged
        expect(result.child(1).textContent).toBe("Hello {{Name}}!");
    });

    test("whitespace-only Text value is a no-op", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{Name}}!"}],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "   ", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        // Variable should remain unchanged
        expect(result.child(1).textContent).toBe("Hello {{Name}}!");
    });

    test("empty Content value is a no-op", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "{{Description}}"}],
            },
        ]);

        const emptyContent = createTestMessageContent([{type: "paragraph"}]);

        const values: ContentDuplicationVariableValues = new Map([
            ["Description", {type: "Content", content: emptyContent}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        // Variable should remain unchanged
        expect(result.child(1).textContent).toBe("{{Description}}");
    });

    test("variable not in values map is not replaced", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{Name}} and {{Other}}!"}],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "World", marks: []}],
            // "Other" is not provided
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        expect(result.child(1).textContent).toBe("Hello World and {{Other}}!");
    });

    test("replaces variable spanning multiple text nodes", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "{{"},
                    {type: "text", text: "Name"},
                    {type: "text", text: "}}"},
                ],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "Bob", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        expect(result.child(1).textContent).toBe("Bob");
    });

    test("replaces variable with spaces inside brackets", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "Hello {{  Name  }}!"}],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "World", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        expect(result.child(1).textContent).toBe("Hello World!");
    });

    test("replaces variable in code block", () => {
        const doc = createTestDocument([
            {
                type: "codeBlock",
                attrs: {language: "text"},
                content: [
                    {
                        type: "codeBlockLine",
                        content: [{type: "text", text: "run {{command}}"}],
                    },
                ],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["command", {type: "Text", text: "npm install", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        const codeBlock = result.child(1);
        const codeLine = codeBlock.child(0);
        expect(codeLine.textContent).toBe("run npm install");
    });

    test("preserves document structure when replacing", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "First {{A}} para"}],
            },
            {
                type: "paragraph",
                content: [{type: "text", text: "Second {{B}} para"}],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["A", {type: "Text", text: "one", marks: []}],
            ["B", {type: "Text", text: "two", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        expect(result.child(1).textContent).toBe("First one para");
        expect(result.child(2).textContent).toBe("Second two para");
    });

    test("Content replacement converts MessageContent to DocumentContent", () => {
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [{type: "text", text: "{{Description}}"}],
            },
        ]);

        // Create message content with multiple paragraphs
        const messageContent = createTestMessageContent([
            {type: "paragraph", content: [{type: "text", text: "Line 1"}]},
            {type: "paragraph", content: [{type: "text", text: "Line 2"}]},
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["Description", {type: "Content", content: messageContent}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        // eslint-disable-next-line cyberworlds/string-quotes
        expect(result.toString()).toEqual('doc(title, paragraph("Line 1"), paragraph("Line 2"))');
    });

    test("replaces variable with mixed styles inside name", () => {
        // {{Hello (plain) + world}} (bold) - apply does NOT trim text nodes, so variable
        // name is "Hello world" (with space)
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "{{Hello "},
                    {type: "text", text: "world}}", marks: [{type: "bold"}]},
                ],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["Hello world", {type: "Text", text: "Goodbye everyone", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        expect(result.child(1).textContent).toBe("Goodbye everyone");
    });

    test("replaces variable with mixed styles inside name not including bracket", () => {
        // {{Hello (plain) + world}} (bold) - apply does NOT trim text nodes, so variable
        // name is "Hello world" (with space)
        const doc = createTestDocument([
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "{{Hello "},
                    {type: "text", text: "world", marks: [{type: "bold"}]},
                    {type: "text", text: "}}"},
                ],
            },
        ]);

        const values: ContentDuplicationVariableValues = new Map([
            ["Hello world", {type: "Text", text: "Goodbye everyone", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValues(doc, values);

        expect(result.child(1).textContent).toBe("Goodbye everyone");
    });
});

describe("encodeContentDuplicationSchemaForUrl / decodeContentDuplicationSchemaFromUrl", () => {
    test("round-trips Text variable without marks", () => {
        const schema: ContentDuplicationVariableSchema = new Map([
            ["Name", {type: "Text", marks: []}],
        ]);

        const encodedSchema = encodeContentDuplicationVariableSchemaForUrl(schema);
        expect(encodedSchema).toEqual("gQEABE5hbWU");

        const decodedSchema = decodeContentDuplicationVariableSchemaFromUrl(encodedSchema);
        expect(decodedSchema.size).toBe(1);
        expect(decodedSchema.get("Name")).toEqual({type: "Text", marks: []});
    });

    test("round-trips Text variable with marks", () => {
        const schema: ContentDuplicationVariableSchema = new Map([
            ["Name", {type: "Text", marks: [{type: "bold"}, {type: "italic"}]}],
        ]);

        const encodedSchema = encodeContentDuplicationVariableSchemaForUrl(schema);
        expect(encodedSchema).toEqual("gQEDBE5hbWU");

        const decodedSchema = decodeContentDuplicationVariableSchemaFromUrl(encodedSchema);
        expect(decodedSchema.size).toBe(1);
        const decodedProp = decodedSchema.get("Name");
        expect(decodedProp?.type).toBe("Text");
        assert(decodedProp?.type === "Text");
        // Marks are decoded in bit order: italic (bit 0), bold (bit 1)
        expect(decodedProp.marks.map((m: {type: string}) => m.type)).toEqual(["italic", "bold"]);
    });

    test("round-trips Content variable", () => {
        const schema: ContentDuplicationVariableSchema = new Map([
            ["Description", {type: "Content"}],
        ]);

        const encodedSchema = encodeContentDuplicationVariableSchemaForUrl(schema);
        expect(encodedSchema).toEqual("gQILRGVzY3JpcHRpb24");

        const decodedSchema = decodeContentDuplicationVariableSchemaFromUrl(encodedSchema);
        expect(decodedSchema.size).toBe(1);
        expect(decodedSchema.get("Description")).toEqual({type: "Content"});
    });

    test("round-trips multiple variables", () => {
        const schema: ContentDuplicationVariableSchema = new Map([
            ["Name", {type: "Text", marks: [{type: "bold"}]}],
            ["Description", {type: "Content"}],
            ["Code", {type: "Text", marks: []}],
        ]);

        const encodedSchema = encodeContentDuplicationVariableSchemaForUrl(schema);
        expect(encodedSchema).toEqual("gwECBE5hbWUCC0Rlc2NyaXB0aW9uAQAEQ29kZQ");

        const decodedSchema = decodeContentDuplicationVariableSchemaFromUrl(encodedSchema);
        expect(decodedSchema.size).toBe(3);
        expect(decodedSchema.get("Description")).toEqual({type: "Content"});

        const nameProp = decodedSchema.get("Name");
        expect(nameProp?.type).toBe("Text");
        assert(nameProp?.type === "Text");
        expect(nameProp.marks.map((m: {type: string}) => m.type)).toEqual(["bold"]);

        expect(decodedSchema.get("Code")).toEqual({type: "Text", marks: []});
    });

    test("handles special characters in variable names", () => {
        const schema: ContentDuplicationVariableSchema = new Map([
            ["User Name", {type: "Text", marks: []}],
        ]);

        const encodedSchema = encodeContentDuplicationVariableSchemaForUrl(schema);
        expect(encodedSchema).toEqual("gQEACVVzZXIgTmFtZQ");

        const decodedSchema = decodeContentDuplicationVariableSchemaFromUrl(encodedSchema);
        expect(decodedSchema.size).toBe(1);
        expect(decodedSchema.has("User Name")).toBe(true);
    });

    test("returns empty schema and title for missing params", () => {
        const decodedSchema = decodeContentDuplicationVariableSchemaFromUrl(null);
        expect(decodedSchema.size).toBe(0);
    });

    test("round-trips Text variable with highlight mark preserving color", () => {
        const schema: ContentDuplicationVariableSchema = new Map([
            ["Name", {type: "Text", marks: [{type: "highlight", color: HighlightColor.Blue}]}],
        ]);

        const encodedSchema = encodeContentDuplicationVariableSchemaForUrl(schema);
        expect(encodedSchema).toEqual("gQFABE5hbWU");

        const decodedSchema = decodeContentDuplicationVariableSchemaFromUrl(encodedSchema);
        expect(decodedSchema.size).toBe(1);
        const decodedProp = decodedSchema.get("Name");
        expect(decodedProp?.type).toBe("Text");
        assert(decodedProp?.type === "Text");
        expect(decodedProp.marks).toHaveLength(1);
        expect(decodedProp.marks[0]!.type).toBe("highlight");
        assert(decodedProp.marks[0]!.type === "highlight");
        expect(decodedProp.marks[0]!.color).toBe(HighlightColor.Blue);
    });

    for (const color of Object.values(HighlightColor)) {
        test(`round-trips highlight color: ${color}`, () => {
            const schema: ContentDuplicationVariableSchema = new Map([
                ["Name", {type: "Text", marks: [{type: "highlight", color}]}],
            ]);

            const decodedSchema = decodeContentDuplicationVariableSchemaFromUrl(
                encodeContentDuplicationVariableSchemaForUrl(schema),
            );
            expect(decodedSchema.size).toBe(1);
            const decodedProp = decodedSchema.get("Name");
            expect(decodedProp?.type).toBe("Text");
            assert(decodedProp?.type === "Text");
            expect(decodedProp.marks).toHaveLength(1);
            expect(decodedProp.marks[0]!.type).toBe("highlight");
            assert(decodedProp.marks[0]!.type === "highlight");
            expect(decodedProp.marks[0]!.color).toBe(color);
        });
    }

    test("round-trips Text variable with highlight and other marks", () => {
        const schema: ContentDuplicationVariableSchema = new Map([
            [
                "Name",
                {
                    type: "Text",
                    marks: [
                        {type: "bold"},
                        {type: "italic"},
                        {type: "highlight", color: HighlightColor.Green},
                    ],
                },
            ],
        ]);

        const encodedSchema = encodeContentDuplicationVariableSchemaForUrl(schema);
        expect(encodedSchema).toEqual("gQEzBE5hbWU");

        const decodedSchema = decodeContentDuplicationVariableSchemaFromUrl(encodedSchema);
        expect(decodedSchema.size).toBe(1);
        const decodedProp = decodedSchema.get("Name");
        expect(decodedProp?.type).toBe("Text");
        assert(decodedProp?.type === "Text");
        expect(decodedProp.marks).toHaveLength(3);
        const markNames = decodedProp.marks.map((m: {type: string}) => m.type);
        expect(markNames).toContain("bold");
        expect(markNames).toContain("italic");
        expect(markNames).toContain("highlight");

        const highlightDecodedMark = decodedProp.marks.find(
            (mark: {type: string}) => mark.type === "highlight",
        );
        assert(highlightDecodedMark?.type === "highlight");
        expect(highlightDecodedMark?.color).toBe(HighlightColor.Green);
    });
});

describe("applyContentDuplicationVariableValuesToText", () => {
    test("replaces Text variable with plain text", () => {
        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "World", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValuesToText("Hello {{Name}}!", values);

        expect(result).toBe("Hello World!");
    });

    test("replaces multiple occurrences of same variable", () => {
        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "Bob", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValuesToText("{{Name}} and {{Name}}", values);

        expect(result).toBe("Bob and Bob");
    });

    test("replaces multiple different variables", () => {
        const values: ContentDuplicationVariableValues = new Map([
            ["First", {type: "Text", text: "John", marks: []}],
            ["Last", {type: "Text", text: "Doe", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValuesToText("{{First}} {{Last}}", values);

        expect(result).toBe("John Doe");
    });

    test("variable not in values map is not replaced", () => {
        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "World", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValuesToText(
            "Hello {{Name}} and {{Other}}!",
            values,
        );

        expect(result).toBe("Hello World and {{Other}}!");
    });

    test("empty text returns empty text", () => {
        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "World", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValuesToText("", values);

        expect(result).toBe("");
    });

    test("empty Text value is a no-op", () => {
        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValuesToText("Hello {{Name}}!", values);

        expect(result).toBe("Hello {{Name}}!");
    });

    test("whitespace-only Text value is a no-op", () => {
        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "   ", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValuesToText("Hello {{Name}}!", values);

        expect(result).toBe("Hello {{Name}}!");
    });

    test("text with no variables returns unchanged", () => {
        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "World", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValuesToText("Hello plain text!", values);

        expect(result).toBe("Hello plain text!");
    });

    test("marks in value are ignored for plain text output", () => {
        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "World", marks: [{type: "bold"}]}],
        ]);

        const result = applyContentDuplicationVariableValuesToText("Hello {{Name}}!", values);

        // Marks don't affect plain text output
        expect(result).toBe("Hello World!");
    });

    test("trims whitespace from variable names", () => {
        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "World", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValuesToText("Hello {{  Name  }}!", values);

        expect(result).toBe("Hello World!");
    });

    test("incomplete variable syntax is not replaced", () => {
        const values: ContentDuplicationVariableValues = new Map([
            ["Name", {type: "Text", text: "World", marks: []}],
        ]);

        const result = applyContentDuplicationVariableValuesToText("Hello {Name}!", values);

        expect(result).toBe("Hello {Name}!");
    });
});
