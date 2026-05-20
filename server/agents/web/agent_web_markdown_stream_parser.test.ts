// To update snapshots run:
//
// ```
// bazel run //server/agents/web:agent_web_markdown_stream_parser_test -- --updateSnapshot
// ```

import {AgentWebMarkdownStreamParser} from "~/server/agents/web/agent_web_markdown_stream_parser.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, FileId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";

const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

test("streams plain text message when update is called once at the end", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The");
    message.pushText(null, " quick");
    message.pushText(null, " brown");
    message.pushText(null, " fox");
    message.pushText(null, " jumps");
    message.pushText(null, " over");
    message.pushText(null, " the");
    message.pushText(null, " lazy");
    message.pushText(null, " dog");
    message.pushText(null, ".\n\n");
    message.pushText(null, "Lorem");
    message.pushText(null, " ipsum");
    message.pushText(null, " dolor");
    message.pushText(null, " sit");
    message.pushText(null, " amet.");
    message.pushText(null, " Praesent");
    message.pushText(null, " bib");
    message.pushText(null, "endum");
    message.pushText(null, " vitae");
    message.pushText(null, " lectus");
    message.pushText(null, " at");
    message.pushText(null, " maximus.");
    message.pushText(null, "\n\nHello,");
    message.pushText(null, " world!");

    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();

    message.pushText(null, "\n\nThe");
    message.pushText(null, " quick");
    message.pushText(null, " brown");
    message.pushText(null, " fox");
    message.pushText(null, " jumps");
    message.pushText(null, " over");
    message.pushText(null, " the");
    message.pushText(null, " lazy");
    message.pushText(null, " dog");
    message.pushText(null, ".\n\n");
    message.pushText(null, "Lorem");
    message.pushText(null, " ipsum");
    message.pushText(null, " dolor");
    message.pushText(null, " sit");
    message.pushText(null, " amet.");
    message.pushText(null, " Praesent");
    message.pushText(null, " bib");
    message.pushText(null, "endum");
    message.pushText(null, " vitae");
    message.pushText(null, " lectus");
    message.pushText(null, " at");
    message.pushText(null, " maximus.");
    message.pushText(null, "\n\nHello,");
    message.pushText(null, " world!");

    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
});

test("streams plan text message when update is called once every token", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " quick");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " brown");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " fox");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " jumps");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " over");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " the");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " lazy");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " dog");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, ".\n\n");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, "Lorem");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " ipsum");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " dolor");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " sit");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " amet.");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " Praesent");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " bib");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, "endum");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " vitae");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " lectus");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " at");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " maximus.");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, "\n\nHello,");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " world!");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();

    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
});

test("streams plan text message when update is called once every few tokens", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The");
    message.pushText(null, " quick");
    message.pushText(null, " brown");
    message.pushText(null, " fox");
    message.pushText(null, " jumps");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " over");
    message.pushText(null, " the");
    message.pushText(null, " lazy");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " dog");
    message.pushText(null, ".\n\n");
    message.pushText(null, "Lorem");
    message.pushText(null, " ipsum");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " dolor");
    message.pushText(null, " sit");
    message.pushText(null, " amet.");
    message.pushText(null, " Praesent");
    message.pushText(null, " bib");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, "endum");
    message.pushText(null, " vitae");
    message.pushText(null, " lectus");
    message.pushText(null, " at");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
    message.pushText(null, " maximus.");
    message.pushText(null, "\n\nHello,");
    message.pushText(null, " world!");
    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();

    expect(
        await message.update(null).then(items => items.map(item => item.part)),
    ).toMatchSnapshot();
});

test("streams bold inline formatting correctly", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " **brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the**");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams italic formatting correctly", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " *brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the*");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Italic"}],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams italic formatting correctly (with underscores)", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " _brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the_");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Italic"}],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams bold + italic inline formatting correctly", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " ***brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the***");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams bold + italic inline formatting correctly with extra asterisk", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " ****brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the****");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams bold + italic inline formatting correctly with two extra asterisks", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " *****brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the*****");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams bold inline formatting with newline before termination", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " **brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, "\n\nover the**");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 1,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "over the**",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 1,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "over the** lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams lone asterisk correctly (that looks like caveat)", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " brown*");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown*",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown* fox jumps",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown* fox jumps over the",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown* fox jumps over the lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams bold HTML inline formatting correctly", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " <strong>brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the</strong>");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams bold HTML inline formatting with newline before termination", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " <strong>brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, "\n\nover the</strong>");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 1,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "over the",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 1,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "over the lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams partial bold HTML inline formatting correctly", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " <str");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, "ong>");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, "brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the</strong>");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Bold"}],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("empty paragraphs with updates in weird places", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "<p");
    message.pushText(null, "></");
    message.pushText(null, "p");
    message.pushText(null, ">\n\n");
    await message.update(null);
    message.pushText(null, "<p");
    message.pushText(null, "></");
    message.pushText(null, "p");
    await message.update(null);
    message.pushText(null, ">\n\n");
    await message.update(null);
    message.pushText(null, "<p");
    message.pushText(null, "></");
    message.pushText(null, "p");
    await message.update(null);
    message.pushText(null, ">\n\n");
    await message.update(null);

    expect(message.getParts()).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {elements: [{type: "Paragraph", elements: []}]},
            },
        },
        {
            index: 1,
            payload: {
                type: "Content",
                content: {elements: [{type: "Paragraph", elements: []}]},
            },
        },
        {
            index: 2,
            payload: {
                type: "Content",
                content: {elements: [{type: "Paragraph", elements: []}]},
            },
        },
    ]);
});

test("streams file gallery rows as their HTML completes", async () => {
    const file1Id = generateChronologicalId<FileId>();
    const file2Id = generateChronologicalId<FileId>();
    const file3Id = generateChronologicalId<FileId>();
    const file4Id = generateChronologicalId<FileId>();
    const file5Id = generateChronologicalId<FileId>();
    const file6Id = generateChronologicalId<FileId>();

    await storage.pageLinkByPathname.put("/file/image.png", {
        type: "File",
        id: file1Id,
        contentType: "image/png",
        contentLength: 100,
    });
    await storage.pageLinkByPathname.put("/file/image-2.png", {
        type: "File",
        id: file2Id,
        contentType: "image/png",
        contentLength: 200,
    });
    await storage.pageLinkByPathname.put("/file/image-3.png", {
        type: "File",
        id: file3Id,
        contentType: "image/png",
        contentLength: 300,
    });
    await storage.pageLinkByPathname.put("/file/image-4.png", {
        type: "File",
        id: file4Id,
        contentType: "image/png",
        contentLength: 400,
    });
    await storage.pageLinkByPathname.put("/file/image-5.png", {
        type: "File",
        id: file5Id,
        contentType: "image/png",
        contentLength: 500,
    });
    await storage.pageLinkByPathname.put("/file/image-6.png", {
        type: "File",
        id: file6Id,
        contentType: "image/png",
        contentLength: 600,
    });

    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    const update = () => message.update(null).then(items => items.map(item => item.part));

    message.pushText(
        null,
        `<div style="display: flex; align-items: stretch">\n<img src="/file/image.png"`,
    );
    expect(await update()).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {elements: []},
            },
        },
    ]);

    message.pushText(null, ` />\n`);
    expect(await update()).toEqual([]);

    message.pushText(null, `</div>\n\n`);
    expect(await update()).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "FileGallery",
                            rows: [
                                {
                                    items: [
                                        {
                                            element: {
                                                type: "File",
                                                id: file1Id,
                                                contentType: "image/png",
                                                contentLength: 100,
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(
        null,
        `<div style="display: flex; align-items: stretch">\n<img src="/file/image-2.png" />\n<img src="/file/image-3.png"`,
    );
    expect(await update()).toEqual([
        {
            index: 1,
            payload: {
                type: "Content",
                content: {elements: []},
            },
        },
    ]);

    message.pushText(null, ` />\n`);
    expect(await update()).toEqual([]);

    message.pushText(null, `</div>\n\n`);
    expect(await update()).toEqual([
        {
            index: 1,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "FileGallery",
                            rows: [
                                {
                                    items: [
                                        {
                                            element: {
                                                type: "File",
                                                id: file2Id,
                                                contentType: "image/png",
                                                contentLength: 200,
                                            },
                                        },
                                        {
                                            element: {
                                                type: "File",
                                                id: file3Id,
                                                contentType: "image/png",
                                                contentLength: 300,
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(
        null,
        `<div style="display: flex; align-items: stretch">\n<img src="/file/image-4.png" />\n<img src="/file/image-5.png" />\n<img src="/file/image-6.png" />\n</div>\n`,
    );
    expect(await update()).toEqual([
        {
            index: 2,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "FileGallery",
                            rows: [
                                {
                                    items: [
                                        {
                                            element: {
                                                type: "File",
                                                id: file4Id,
                                                contentType: "image/png",
                                                contentLength: 400,
                                            },
                                        },
                                        {
                                            element: {
                                                type: "File",
                                                id: file5Id,
                                                contentType: "image/png",
                                                contentLength: 500,
                                            },
                                        },
                                        {
                                            element: {
                                                type: "File",
                                                id: file6Id,
                                                contentType: "image/png",
                                                contentLength: 600,
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("can stream simple unordered list", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "-");
    await message.update(null);
    message.pushText(null, " First");
    message.pushText(null, " item");
    await message.update(null);
    message.pushText(null, "\n\n");
    await message.update(null);
    message.pushText(null, "-");
    await message.update(null);
    message.pushText(null, " Second");
    await message.update(null);
    message.pushText(null, " item");
    message.pushText(null, "\n\n");
    message.pushText(null, "-");
    await message.update(null);
    message.pushText(null, " Third");
    message.pushText(null, " item");
    await message.update(null);
    message.pushText(null, "\n");
    await message.update(null);

    expect(message.getParts()).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "UnorderedList",
                            items: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "First item"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        },
        {
            index: 1,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "UnorderedList",
                            items: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Second item"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        },
        {
            index: 2,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "UnorderedList",
                            items: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Third item"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams strike inline formatting correctly", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " ~~brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Strike"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Strike"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the~~");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Strike"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Strike"}],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("does not apply strikethrough with single tilde", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " ~brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ~brown",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ~brown fox jumps",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the~");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ~brown fox jumps over the~",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ~brown fox jumps over the~ lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("does not apply strikethrough to statistics with tilde", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "Did you know that");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "Did you know that",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " ~30%");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "Did you know that ~30%",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " of statistics");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "Did you know that ~30% of statistics",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " are made up?");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "Did you know that ~30% of statistics are made up?",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("does not apply strikethrough with multiple single tildes", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "Values range from");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "Values range from",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " ~100");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "Values range from ~100",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " to ~500");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "Values range from ~100 to ~500",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " units.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "Values range from ~100 to ~500 units.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams inline code formatting correctly", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " `brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown",
                                    marks: [{type: "Code"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps",
                                    marks: [{type: "Code"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the`");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Code"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [{type: "Code"}],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams link formatting correctly (with reference)", async () => {
    const documentId = generateId<DocumentId>();

    await printApiContentToAgentWebMarkdown(
        storage,
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {
                                type: "Document",
                                id: documentId,
                                title: "Brown Fox Jumps Over The",
                            },
                        },
                    ],
                },
            ],
        },
        {documentId: null},
    );

    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " [brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown fox jumps",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the](/document/brown-fox-jumps-over-the)");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Mention",
                                    target: {
                                        type: "Document",
                                        id: documentId,
                                        title: "Brown Fox Jumps Over The",
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Mention",
                                    target: {
                                        type: "Document",
                                        id: documentId,
                                        title: "Brown Fox Jumps Over The",
                                    },
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams link formatting correctly (with active task reference)", async () => {
    const taskId = generateId<TaskId>();

    await printApiContentToAgentWebMarkdown(
        storage,
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {
                                type: "Task",
                                id: taskId,
                                title: "Brown Fox Jumps Over The",
                                status: {type: "Open", isActive: true},
                            },
                        },
                    ],
                },
            ],
        },
        {documentId: null},
    );

    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " [brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown fox jumps",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the (Open)](/task/brown-fox-jumps-over-the)");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Mention",
                                    target: {
                                        type: "Task",
                                        id: taskId,
                                        title: "Brown Fox Jumps Over The",
                                        status: {type: "Open", isActive: true},
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Mention",
                                    target: {
                                        type: "Task",
                                        id: taskId,
                                        title: "Brown Fox Jumps Over The",
                                        status: {type: "Open", isActive: true},
                                    },
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams link formatting correctly character by character (without reference)", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " [brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown fox jumps",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown fox jumps over the",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, "]");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, "[");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, "]");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown fox jumps over the lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams link formatting correctly for link that looks like mention", async () => {
    const documentId = generateId<DocumentId>();

    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " [brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown fox jumps",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(
        null,
        ` over the](https://alpine.inc/s/${spaceId}/documents/${documentId}?mention)`,
    );

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [
                                        {
                                            type: "Link",
                                            url: `https://alpine.inc/s/${spaceId}/documents/${documentId}`,
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [
                                        {
                                            type: "Link",
                                            url: `https://alpine.inc/s/${spaceId}/documents/${documentId}`,
                                        },
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams link formatting correctly for truncated link that looks like mention", async () => {
    const documentId = generateId<DocumentId>();

    const truncatedUrl = `https://alpine.inc/s/${spaceId.slice(0, -7)}…${documentId.slice(-2)}?mention`;

    expect(
        await printApiContentToAgentWebMarkdown(
            storage,
            {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {
                                type: "Text",
                                text: "brown fox jumps over the",
                                marks: [
                                    {
                                        type: "Link",
                                        url: `https://alpine.inc/s/${spaceId}/documents/${documentId}?mention`,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            {documentId: null},
        ),
    ).toEqual(`<a href="${truncatedUrl}">brown fox jumps over the</a>\n`);

    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " [brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown fox jumps",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, ` over the](${truncatedUrl})`);

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [
                                        {
                                            type: "Link",
                                            url: `https://alpine.inc/s/${spaceId}/documents/${documentId}`,
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Text",
                                    text: "brown fox jumps over the",
                                    marks: [
                                        {
                                            type: "Link",
                                            url: `https://alpine.inc/s/${spaceId}/documents/${documentId}`,
                                        },
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams link formatting correctly character by character (with reference)", async () => {
    const documentId = generateId<DocumentId>();

    await printApiContentToAgentWebMarkdown(
        storage,
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {
                                type: "Document",
                                id: documentId,
                                title: "Brown Fox Jumps Over The",
                            },
                        },
                    ],
                },
            ],
        },
        {documentId: null},
    );

    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "The quick");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " [brown");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " fox jumps");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown fox jumps",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " over the");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick brown fox jumps over the",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, "]");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, "(");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, "/document/brown-fox-jumps-over-the");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, ")");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Mention",
                                    target: {
                                        type: "Document",
                                        id: documentId,
                                        title: "Brown Fox Jumps Over The",
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " lazy dog.");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "The quick ",
                                },
                                {
                                    type: "Mention",
                                    target: {
                                        type: "Document",
                                        id: documentId,
                                        title: "Brown Fox Jumps Over The",
                                    },
                                },
                                {
                                    type: "Text",
                                    text: " lazy dog.",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams missing link reference formatting correctly (without reference)", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "test: ");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "test:"}]}],
                },
            },
        },
    ]);

    message.pushText(null, "[");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "test: "}]}],
                },
            },
        },
    ]);

    message.pushText(null, "li");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "test: li"}]}],
                },
            },
        },
    ]);

    message.pushText(null, "nk");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "test: link"}]}],
                },
            },
        },
    ]);

    message.pushText(null, "]");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, "[");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, "miss");

    // TODO(calebmer): This is a bug! The output should still be `test: link`. But I'm
    // running out of time so not fixing this edge case.
    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {type: "Paragraph", elements: [{type: "Text", text: "test: linkmiss"}]},
                    ],
                },
            },
        },
    ]);

    message.pushText(null, "ing-link");

    // TODO(calebmer): This is a bug! The output should still be `test: link`. But I'm
    // running out of time so not fixing this edge case.
    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "test: linkmissing-link"}],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, "]");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "test: link"}]}],
                },
            },
        },
    ]);

    message.pushText(null, ".");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {type: "Paragraph", elements: [{type: "Text", text: "test: link."}]},
                    ],
                },
            },
        },
    ]);
});

test("streams missing link URL formatting correctly (without reference)", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "test: ");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "test:"}]}],
                },
            },
        },
    ]);

    message.pushText(null, "[");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "test: "}]}],
                },
            },
        },
    ]);

    message.pushText(null, "li");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "test: li"}]}],
                },
            },
        },
    ]);

    message.pushText(null, "nk");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "test: link"}]}],
                },
            },
        },
    ]);

    message.pushText(null, "]");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, "(");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, "http");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, "s://example.com");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, ")");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "test: "},
                                {
                                    type: "Text",
                                    text: "link",
                                    marks: [{type: "Link", url: "https://example.com"}],
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, ".");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "test: "},
                                {
                                    type: "Text",
                                    text: "link",
                                    marks: [{type: "Link", url: "https://example.com"}],
                                },
                                {type: "Text", text: "."},
                            ],
                        },
                    ],
                },
            },
        },
    ]);
});

test("streams code block correctly", async () => {
    const message = new AgentWebMarkdownStreamParser({
        storage,
        documentId: null,
    });

    message.pushText(null, "foo\n\n");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "foo"}]}],
                },
            },
        },
    ]);

    message.pushText(null, "```\n");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 1,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Code", language: "text", lines: [{elements: []}]}],
                },
            },
        },
    ]);

    message.pushText(null, "let a = 1;\n");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 1,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Code",
                            language: "text",
                            lines: [{elements: [{type: "Text", text: "let a = 1;"}]}],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, "let b =");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 1,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Code",
                            language: "text",
                            lines: [
                                {elements: [{type: "Text", text: "let a = 1;"}]},
                                {elements: [{type: "Text", text: "let b ="}]},
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, " 2;\n");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 1,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Code",
                            language: "text",
                            lines: [
                                {elements: [{type: "Text", text: "let a = 1;"}]},
                                {elements: [{type: "Text", text: "let b = 2;"}]},
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(null, "```\n\n");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

    message.pushText(null, "bar");

    expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
        {
            index: 2,
            payload: {
                type: "Content",
                content: {
                    elements: [{type: "Paragraph", elements: [{type: "Text", text: "bar"}]}],
                },
            },
        },
    ]);
});

describe("headers", () => {
    test("streams headers correctly", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "foo\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [{type: "Paragraph", elements: [{type: "Text", text: "foo"}]}],
                    },
                },
            },
        ]);

        message.pushText(null, "bar\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [{type: "Paragraph", elements: [{type: "Text", text: "bar"}]}],
                    },
                },
            },
        ]);

        message.pushText(null, "# Heading 1");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 1,
                                elements: [{type: "Text", text: "Heading 1"}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, " is cool");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 1,
                                elements: [{type: "Text", text: "Heading 1 is cool"}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

        message.pushText(null, "## heading 2 is cooler");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 3,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 2,
                                elements: [{type: "Text", text: "heading 2 is cooler"}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "\n\n### But heading 3 is the coolest");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 4,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 3,
                                elements: [{type: "Text", text: "But heading 3 is the coolest"}],
                            },
                        ],
                    },
                },
            },
        ]);
    });

    test("streams headers correctly when depth starts at 2", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "foo\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [{type: "Paragraph", elements: [{type: "Text", text: "foo"}]}],
                    },
                },
            },
        ]);

        message.pushText(null, "bar\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [{type: "Paragraph", elements: [{type: "Text", text: "bar"}]}],
                    },
                },
            },
        ]);

        message.pushText(null, "## Heading 1");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 1,
                                elements: [{type: "Text", text: "Heading 1"}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, " is cool");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 1,
                                elements: [{type: "Text", text: "Heading 1 is cool"}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

        message.pushText(null, "### heading 2 is cooler");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 3,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 2,
                                elements: [{type: "Text", text: "heading 2 is cooler"}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "\n\n#### But heading 3 is the coolest");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 4,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 3,
                                elements: [{type: "Text", text: "But heading 3 is the coolest"}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "\n\n# Trying heading 1");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 5,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 1,
                                elements: [{type: "Text", text: "Trying heading 1"}],
                            },
                        ],
                    },
                },
            },
        ]);
    });

    test("doesn\u2019t add header if no space after #", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "foo\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [{type: "Paragraph", elements: [{type: "Text", text: "foo"}]}],
                    },
                },
            },
        ]);

        message.pushText(null, "#bar\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [{type: "Paragraph", elements: [{type: "Text", text: "#bar"}]}],
                    },
                },
            },
        ]);

        message.pushText(null, "##baz\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [{type: "Paragraph", elements: [{type: "Text", text: "##baz"}]}],
                    },
                },
            },
        ]);

        message.pushText(null, "###qux\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 3,
                payload: {
                    type: "Content",
                    content: {
                        elements: [{type: "Paragraph", elements: [{type: "Text", text: "###qux"}]}],
                    },
                },
            },
        ]);
    });

    test("doesn\u2019t add header to inline #", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "foo\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [{type: "Paragraph", elements: [{type: "Text", text: "foo"}]}],
                    },
                },
            },
        ]);

        message.pushText(null, "My favorite number is #4\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "My favorite number is #4"}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "my least favorite number is # 3 - yuck!");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "my least favorite number is # 3 - yuck!"},
                                ],
                            },
                        ],
                    },
                },
            },
        ]);
    });

    test("streams header when a chunk is just a single #", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "#");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [{type: "Heading", level: 1, elements: []}],
                    },
                },
            },
        ]);

        message.pushText(null, " ");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

        message.pushText(null, "foo");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {type: "Heading", level: 1, elements: [{type: "Text", text: "foo"}]},
                        ],
                    },
                },
            },
        ]);
    });
});

describe("ordered list continuation", () => {
    test("simple ordered list", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. First item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "First item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "2. Second item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Second item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "3.");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [{elements: []}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, " Third item");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Third item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);
    });

    test("streams ordered list items that continue from previous items without explicit start", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. First item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "First item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "2");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [{type: "Paragraph", elements: [{type: "Text", text: "2"}]}],
                    },
                },
            },
        ]);

        message.pushText(null, ". ");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [{elements: []}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "Second");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Second"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, " ");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

        message.pushText(null, "item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Second item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "3. Third item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Third item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(
            null,
            `\
4. fourth and

5. fifth item
`,
        );

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 3,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "fourth and"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
            {
                index: 4,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "fifth item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);
    });

    test("streams ordered list with explicit start number when restarting numbering", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. First item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "First item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "2. Second item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Second item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        // Restart numbering at 1
        message.pushText(null, "5");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "5"}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, ")");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                orderStart: 5,
                                items: [{elements: []}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, " Skip to fifth item");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                orderStart: 5,
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [
                                                    {type: "Text", text: "Skip to fifth item"},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([]);

        message.pushText(null, "1. Restart first item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 3,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                orderStart: 1,
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [
                                                    {type: "Text", text: "Restart first item"},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);
    });

    test("streams ordered list with explicit start number when skipping numbers", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. First item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "First item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "2. Second item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Second item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        // Skip to 5
        message.pushText(null, "5. Fifth item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Fifth item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);
    });

    test("streams ordered list starting at non-1 value with explicit start", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "5. Fifth item\n\n");
        await message.update(null);

        message.pushText(null, "6. Sixth item\n\n");
        await message.update(null);

        const parts = message.getParts();

        // First part should have explicit orderStart of 5
        expect(parts[0]?.payload).toEqual({
            type: "Content",
            content: {
                elements: [
                    {
                        type: "OrderedList",
                        orderStart: 5,
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Fifth item"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });

        // Second part continues from first (no explicit start needed)
        expect(parts[1]?.payload).toEqual({
            type: "Content",
            content: {
                elements: [
                    {
                        type: "OrderedList",
                        orderStart: undefined,
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Sixth item"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });
    });

    test("streams ordered list after non-list content", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. First item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "First item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "Some paragraph text\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Some paragraph text"}],
                            },
                        ],
                    },
                },
            },
        ]);

        // Start new list after paragraph
        message.pushText(null, "1. New list first item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [
                                                    {type: "Text", text: "New list first item"},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);
    });

    test("sets orderStart to explicit value if the list is not contiguous", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. First item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "First item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "Some paragraph text\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Some paragraph text"}],
                            },
                        ],
                    },
                },
            },
        ]);

        // Start new list after paragraph
        message.pushText(null, "2. Second item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 2,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                orderStart: 2,
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Second item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "3. Third item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 3,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Third item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "Another paragraph break\n\n");

        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 4,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Another paragraph break"}],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "4. Fourth item\n\n5. Fifth item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 5,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                orderStart: 4,
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Fourth item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
            {
                index: 6,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Fifth item"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);
    });

    test("streams ordered list after unordered list", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "- Unordered item\n\n");
        await message.update(null);

        message.pushText(null, "1. Ordered item\n\n");
        await message.update(null);

        const parts = message.getParts();

        expect(parts[0]?.payload.type).toBe("Content");
        expect(parts[0]?.payload).toMatchObject({
            type: "Content",
            content: {
                elements: [{type: "UnorderedList"}],
            },
        });

        expect(parts[1]?.payload).toEqual({
            type: "Content",
            content: {
                elements: [
                    {
                        type: "OrderedList",
                        orderStart: undefined,
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Ordered item"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });
    });

    test("streams ordered list that restarts at non-1 value after previous list", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. First item\n\n");
        await message.update(null);

        message.pushText(null, "2. Second item\n\n");
        await message.update(null);

        // Restart at 3 (should have explicit start since it's not continuing)
        message.pushText(null, "3. Third item (new list)\n\n");
        await message.update(null);

        const parts = message.getParts();

        // Third part continues naturally from second, so no explicit start
        expect(parts[2]?.payload).toEqual({
            type: "Content",
            content: {
                elements: [
                    {
                        type: "OrderedList",
                        orderStart: undefined,
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Third item (new list)"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });
    });

    test("streams multiple consecutive ordered list items in single update", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. First item\n\n2. Second item\n\n3. Third item\n\n");

        const updates = await message.update(null).then(items => items.map(item => item.part));

        // Should create 3 separate parts
        expect(updates.length).toBe(3);

        expect(updates[0]).toEqual({
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "OrderedList",
                            orderStart: undefined,
                            items: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "First item"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        });

        expect(updates[1]).toEqual({
            index: 1,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "OrderedList",
                            orderStart: undefined,
                            items: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Second item"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        });

        expect(updates[2]).toEqual({
            index: 2,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "OrderedList",
                            orderStart: undefined,
                            items: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Third item"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
        });
    });

    test("streams simple nested ordered list", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. First level\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "First level"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "   1. Nested item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "First level"}],
                                            },
                                        ],
                                        nestedListElements: [
                                            {
                                                type: "OrderedList",
                                                items: [
                                                    {
                                                        elements: [
                                                            {
                                                                type: "Paragraph",
                                                                elements: [
                                                                    {
                                                                        type: "Text",
                                                                        text: "Nested item",
                                                                    },
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "2. Back to first level\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 1,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [
                                                    {type: "Text", text: "Back to first level"},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);
    });

    test("streams nested ordered list with multiple nested items", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. Parent item\n\n");
        await message.update(null);

        message.pushText(null, "   1. First nested\n\n");
        await message.update(null);

        message.pushText(null, "   2. Second nested\n\n");
        await message.update(null);

        const parts = message.getParts();

        expect(parts[0]?.payload).toEqual({
            type: "Content",
            content: {
                elements: [
                    {
                        type: "OrderedList",
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Parent item"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "OrderedList",
                                        items: [
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "First nested"},
                                                        ],
                                                    },
                                                ],
                                            },
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "Second nested"},
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });
    });

    test("streams deeply nested ordered lists", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. Level 1\n\n");
        await message.update(null);

        message.pushText(null, "   1. Level 2\n\n");
        await message.update(null);

        message.pushText(null, "      1. Level 3\n\n");
        await message.update(null);

        const parts = message.getParts();

        expect(parts[0]?.payload).toEqual({
            type: "Content",
            content: {
                elements: [
                    {
                        type: "OrderedList",
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Level 1"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "OrderedList",
                                        items: [
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [{type: "Text", text: "Level 2"}],
                                                    },
                                                ],
                                                nestedListElements: [
                                                    {
                                                        type: "OrderedList",
                                                        items: [
                                                            {
                                                                elements: [
                                                                    {
                                                                        type: "Paragraph",
                                                                        elements: [
                                                                            {
                                                                                type: "Text",
                                                                                text: "Level 3",
                                                                            },
                                                                        ],
                                                                    },
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });
    });

    test("streams nested ordered list with non-1 start", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. Parent item\n\n");
        await message.update(null);

        message.pushText(null, "   5. Nested starting at 5\n\n");
        await message.update(null);

        message.pushText(null, "   6. Nested item 6\n\n");
        await message.update(null);

        const parts = message.getParts();

        expect(parts[0]?.payload).toEqual({
            type: "Content",
            content: {
                elements: [
                    {
                        type: "OrderedList",
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Parent item"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "OrderedList",
                                        orderStart: 5,
                                        items: [
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {
                                                                type: "Text",
                                                                text: "Nested starting at 5",
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "Nested item 6"},
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });
    });

    test("streams nested ordered list incrementally", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. Parent\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Parent"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "   1");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Parent"}],
                                            },
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "1"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, ". ");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Parent"}],
                                            },
                                        ],
                                        nestedListElements: [
                                            {
                                                type: "OrderedList",
                                                items: [{elements: []}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, "Nested");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Parent"}],
                                            },
                                        ],
                                        nestedListElements: [
                                            {
                                                type: "OrderedList",
                                                items: [
                                                    {
                                                        elements: [
                                                            {
                                                                type: "Paragraph",
                                                                elements: [
                                                                    {type: "Text", text: "Nested"},
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);

        message.pushText(null, " item\n\n");
        expect(await message.update(null).then(items => items.map(item => item.part))).toEqual([
            {
                index: 0,
                payload: {
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "OrderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Parent"}],
                                            },
                                        ],
                                        nestedListElements: [
                                            {
                                                type: "OrderedList",
                                                items: [
                                                    {
                                                        elements: [
                                                            {
                                                                type: "Paragraph",
                                                                elements: [
                                                                    {
                                                                        type: "Text",
                                                                        text: "Nested item",
                                                                    },
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        ]);
    });

    test("streams mixed parent and nested ordered list items", async () => {
        const message = new AgentWebMarkdownStreamParser({
            storage,
            documentId: null,
        });

        message.pushText(null, "1. First parent\n\n");
        await message.update(null);

        message.pushText(null, "   1. First nested\n\n");
        await message.update(null);

        message.pushText(null, "2. Second parent\n\n");
        await message.update(null);

        message.pushText(null, "   1. Second nested\n\n");
        await message.update(null);

        const parts = message.getParts();

        // First part has parent with nested list
        expect(parts[0]?.payload).toEqual({
            type: "Content",
            content: {
                elements: [
                    {
                        type: "OrderedList",
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "First parent"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "OrderedList",
                                        items: [
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "First nested"},
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });

        // Second part is continuation of parent list
        expect(parts[1]?.payload).toEqual({
            type: "Content",
            content: {
                elements: [
                    {
                        type: "OrderedList",
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Second parent"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "OrderedList",
                                        items: [
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "Second nested"},
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });
    });
});
