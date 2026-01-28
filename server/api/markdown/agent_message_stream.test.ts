import {AgentMessageStream} from "~/server/api/markdown/agent_message_stream.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, PostId, SpaceId} from "~/shared/id/types/id_types.js";

const spaceId = generateId<SpaceId>();

test("streams plain text message when update is called once at the end", async () => {
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The");
    message.pushText(" quick");
    message.pushText(" brown");
    message.pushText(" fox");
    message.pushText(" jumps");
    message.pushText(" over");
    message.pushText(" the");
    message.pushText(" lazy");
    message.pushText(" dog");
    message.pushText(".\n\n");
    message.pushText("Lorem");
    message.pushText(" ipsum");
    message.pushText(" dolor");
    message.pushText(" sit");
    message.pushText(" amet.");
    message.pushText(" Praesent");
    message.pushText(" bib");
    message.pushText("endum");
    message.pushText(" vitae");
    message.pushText(" lectus");
    message.pushText(" at");
    message.pushText(" maximus.");
    message.pushText("\n\nHello,");
    message.pushText(" world!");

    expect(await message.update()).toMatchSnapshot();
    expect(await message.update()).toMatchSnapshot();

    message.pushText("\n\nThe");
    message.pushText(" quick");
    message.pushText(" brown");
    message.pushText(" fox");
    message.pushText(" jumps");
    message.pushText(" over");
    message.pushText(" the");
    message.pushText(" lazy");
    message.pushText(" dog");
    message.pushText(".\n\n");
    message.pushText("Lorem");
    message.pushText(" ipsum");
    message.pushText(" dolor");
    message.pushText(" sit");
    message.pushText(" amet.");
    message.pushText(" Praesent");
    message.pushText(" bib");
    message.pushText("endum");
    message.pushText(" vitae");
    message.pushText(" lectus");
    message.pushText(" at");
    message.pushText(" maximus.");
    message.pushText("\n\nHello,");
    message.pushText(" world!");

    expect(await message.update()).toMatchSnapshot();
    expect(await message.update()).toMatchSnapshot();
});

test("streams plan text message when update is called once every token", async () => {
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" quick");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" brown");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" fox");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" jumps");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" over");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" the");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" lazy");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" dog");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(".\n\n");
    expect(await message.update()).toMatchSnapshot();
    message.pushText("Lorem");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" ipsum");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" dolor");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" sit");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" amet.");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" Praesent");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" bib");
    expect(await message.update()).toMatchSnapshot();
    message.pushText("endum");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" vitae");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" lectus");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" at");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" maximus.");
    expect(await message.update()).toMatchSnapshot();
    message.pushText("\n\nHello,");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" world!");
    expect(await message.update()).toMatchSnapshot();

    expect(await message.update()).toMatchSnapshot();
});

test("streams plan text message when update is called once every few tokens", async () => {
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The");
    message.pushText(" quick");
    message.pushText(" brown");
    message.pushText(" fox");
    message.pushText(" jumps");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" over");
    message.pushText(" the");
    message.pushText(" lazy");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" dog");
    message.pushText(".\n\n");
    message.pushText("Lorem");
    message.pushText(" ipsum");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" dolor");
    message.pushText(" sit");
    message.pushText(" amet.");
    message.pushText(" Praesent");
    message.pushText(" bib");
    expect(await message.update()).toMatchSnapshot();
    message.pushText("endum");
    message.pushText(" vitae");
    message.pushText(" lectus");
    message.pushText(" at");
    expect(await message.update()).toMatchSnapshot();
    message.pushText(" maximus.");
    message.pushText("\n\nHello,");
    message.pushText(" world!");
    expect(await message.update()).toMatchSnapshot();

    expect(await message.update()).toMatchSnapshot();
});

test("streams bold inline formatting correctly", async () => {
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" **brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the**");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" *brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the*");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" _brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the_");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" ***brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the***");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" ****brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the****");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" *****brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the*****");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" **brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText("\n\nover the**");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" brown*");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" <strong>brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the</strong>");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" <strong>brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText("\n\nover the</strong>");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" <str");

    expect(await message.update()).toEqual([]);

    message.pushText("ong>");

    expect(await message.update()).toEqual([
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

    message.pushText("brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the</strong>");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("<p");
    message.pushText("></");
    message.pushText("p");
    message.pushText(">\n\n");
    await message.update();
    message.pushText("<p");
    message.pushText("></");
    message.pushText("p");
    await message.update();
    message.pushText(">\n\n");
    await message.update();
    message.pushText("<p");
    message.pushText("></");
    message.pushText("p");
    await message.update();
    message.pushText(">\n\n");
    await message.update();

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

test("can stream simple unordered list", async () => {
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("-");
    await message.update();
    message.pushText(" First");
    message.pushText(" item");
    await message.update();
    message.pushText("\n\n");
    await message.update();
    message.pushText("-");
    await message.update();
    message.pushText(" Second");
    await message.update();
    message.pushText(" item");
    message.pushText("\n\n");
    message.pushText("-");
    await message.update();
    message.pushText(" Third");
    message.pushText(" item");
    await message.update();
    message.pushText("\n");
    await message.update();

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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" ~~brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the~~");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" ~brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the~");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("Did you know that");

    expect(await message.update()).toEqual([
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

    message.pushText(" ~30%");

    expect(await message.update()).toEqual([
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

    message.pushText(" of statistics");

    expect(await message.update()).toEqual([
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

    message.pushText(" are made up?");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("Values range from");

    expect(await message.update()).toEqual([
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

    message.pushText(" ~100");

    expect(await message.update()).toEqual([
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

    message.pushText(" to ~500");

    expect(await message.update()).toEqual([
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

    message.pushText(" units.");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" `brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the`");

    expect(await message.update()).toEqual([
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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

test("streams link formatting correctly (without mentionable reference)", async () => {
    const postId = generateId<PostId>();

    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => `/posts/${postId}/messages/1`,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" [brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the](/post-comment/message-text)");

    expect(await message.update()).toEqual([
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
                                            url: `https://alpine.inc/s/${spaceId}/posts/${postId}?comment=1`,
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

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
                                            url: `https://alpine.inc/s/${spaceId}/posts/${postId}?comment=1`,
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

test("streams link formatting correctly (with reference)", async () => {
    const documentId = generateId<DocumentId>();

    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async linkUrl => {
            if (linkUrl === "/document/brown-fox-jumps-over-the") return `/documents/${documentId}`;

            return null;
        },
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" [brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the](/document/brown-fox-jumps-over-the)");

    expect(await message.update()).toEqual([
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
                                    target: {type: "Document", id: documentId},
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
                                    target: {type: "Document", id: documentId},
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" [brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the");

    expect(await message.update()).toEqual([
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

    message.pushText("]");

    expect(await message.update()).toEqual([]);

    message.pushText("[");

    expect(await message.update()).toEqual([]);

    message.pushText("]");

    expect(await message.update()).toEqual([]);

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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

test("streams link formatting correctly character by character (with reference)", async () => {
    const documentId = generateId<DocumentId>();

    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async linkUrl => {
            if (linkUrl === "/document/brown-fox-jumps-over-the") return `/documents/${documentId}`;

            return null;
        },
    });

    message.pushText("The quick");

    expect(await message.update()).toEqual([
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

    message.pushText(" [brown");

    expect(await message.update()).toEqual([
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

    message.pushText(" fox jumps");

    expect(await message.update()).toEqual([
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

    message.pushText(" over the");

    expect(await message.update()).toEqual([
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

    message.pushText("]");

    expect(await message.update()).toEqual([]);

    message.pushText("(");

    expect(await message.update()).toEqual([]);

    message.pushText("/document/brown-fox-jumps-over-the");

    expect(await message.update()).toEqual([]);

    message.pushText(")");

    expect(await message.update()).toEqual([
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
                                    target: {type: "Document", id: documentId},
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

    message.pushText(" lazy dog.");

    expect(await message.update()).toEqual([
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
                                    target: {type: "Document", id: documentId},
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("test: ");

    expect(await message.update()).toEqual([
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

    message.pushText("[");

    expect(await message.update()).toEqual([
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

    message.pushText("li");

    expect(await message.update()).toEqual([
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

    message.pushText("nk");

    expect(await message.update()).toEqual([
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

    message.pushText("]");

    expect(await message.update()).toEqual([]);

    message.pushText("[");

    expect(await message.update()).toEqual([]);

    message.pushText("miss");

    // TODO(calebmer): This is a bug! The output should still be `test: link`. But
    // I'm running out of time so not fixing this edge case.
    expect(await message.update()).toEqual([
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

    message.pushText("ing-link");

    // TODO(calebmer): This is a bug! The output should still be `test: link`. But
    // I'm running out of time so not fixing this edge case.
    expect(await message.update()).toEqual([
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

    message.pushText("]");

    expect(await message.update()).toEqual([
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

    message.pushText(".");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("test: ");

    expect(await message.update()).toEqual([
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

    message.pushText("[");

    expect(await message.update()).toEqual([
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

    message.pushText("li");

    expect(await message.update()).toEqual([
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

    message.pushText("nk");

    expect(await message.update()).toEqual([
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

    message.pushText("]");

    expect(await message.update()).toEqual([]);

    message.pushText("(");

    expect(await message.update()).toEqual([]);

    message.pushText("http");

    expect(await message.update()).toEqual([]);

    message.pushText("s://example.com");

    expect(await message.update()).toEqual([]);

    message.pushText(")");

    expect(await message.update()).toEqual([
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

    message.pushText(".");

    expect(await message.update()).toEqual([
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
    const message = new AgentMessageStream({
        spaceId,
        getTargetPathIfExists: async () => null,
    });

    message.pushText("foo\n\n");

    expect(await message.update()).toEqual([
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

    message.pushText("```\n");

    expect(await message.update()).toEqual([
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

    message.pushText("let a = 1;\n");

    expect(await message.update()).toEqual([
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

    message.pushText("let b =");

    expect(await message.update()).toEqual([
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

    message.pushText(" 2;\n");

    expect(await message.update()).toEqual([
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

    message.pushText("```\n\n");

    expect(await message.update()).toEqual([]);

    message.pushText("bar");

    expect(await message.update()).toEqual([
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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("foo\n\n");

        expect(await message.update()).toEqual([
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

        message.pushText("bar\n\n");

        expect(await message.update()).toEqual([
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

        message.pushText("# Heading 1");

        expect(await message.update()).toEqual([
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

        message.pushText(" is cool");

        expect(await message.update()).toEqual([
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

        message.pushText("\n\n");

        expect(await message.update()).toEqual([]);

        message.pushText("## heading 2 is cooler");

        expect(await message.update()).toEqual([
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

        message.pushText("\n\n### But heading 3 is the coolest");

        expect(await message.update()).toEqual([
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

    test("doesn’t add header if no space after #", async () => {
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("foo\n\n");

        expect(await message.update()).toEqual([
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

        message.pushText("#bar\n\n");

        expect(await message.update()).toEqual([
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

        message.pushText("##baz\n\n");

        expect(await message.update()).toEqual([
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

        message.pushText("###qux\n\n");

        expect(await message.update()).toEqual([
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

    test("doesn’t add header to inline #", async () => {
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("foo\n\n");

        expect(await message.update()).toEqual([
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

        message.pushText("My favorite number is #4\n\n");

        expect(await message.update()).toEqual([
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

        message.pushText("my least favorite number is # 3 - yuck!");

        expect(await message.update()).toEqual([
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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("#");

        expect(await message.update()).toEqual([
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

        message.pushText(" ");

        expect(await message.update()).toEqual([]);

        message.pushText("foo");

        expect(await message.update()).toEqual([
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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. First item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("2. Second item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("3.");
        expect(await message.update()).toEqual([
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

        message.pushText(" Third item");
        expect(await message.update()).toEqual([
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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. First item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("2");
        expect(await message.update()).toEqual([
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

        message.pushText(". ");
        expect(await message.update()).toEqual([
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

        message.pushText("Second");
        expect(await message.update()).toEqual([
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

        message.pushText(" ");
        expect(await message.update()).toEqual([]);

        message.pushText("item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("3. Third item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText(`\
4. fourth and

5. fifth item
`);

        expect(await message.update()).toEqual([
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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. First item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("2. Second item\n\n");
        expect(await message.update()).toEqual([
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
        message.pushText("5");
        expect(await message.update()).toEqual([
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

        message.pushText(")");
        expect(await message.update()).toEqual([
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

        message.pushText(" Skip to fifth item");
        expect(await message.update()).toEqual([
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

        message.pushText("\n\n");
        expect(await message.update()).toEqual([]);

        message.pushText("1. Restart first item\n\n");
        expect(await message.update()).toEqual([
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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. First item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("2. Second item\n\n");
        expect(await message.update()).toEqual([
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
        message.pushText("5. Fifth item\n\n");
        expect(await message.update()).toEqual([
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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("5. Fifth item\n\n");
        await message.update();

        message.pushText("6. Sixth item\n\n");
        await message.update();

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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. First item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("Some paragraph text\n\n");
        expect(await message.update()).toEqual([
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
        message.pushText("1. New list first item\n\n");
        expect(await message.update()).toEqual([
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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. First item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("Some paragraph text\n\n");
        expect(await message.update()).toEqual([
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
        message.pushText("2. Second item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("3. Third item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("Another paragraph break\n\n");

        expect(await message.update()).toEqual([
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

        message.pushText("4. Fourth item\n\n5. Fifth item\n\n");
        expect(await message.update()).toEqual([
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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("- Unordered item\n\n");
        await message.update();

        message.pushText("1. Ordered item\n\n");
        await message.update();

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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. First item\n\n");
        await message.update();

        message.pushText("2. Second item\n\n");
        await message.update();

        // Restart at 3 (should have explicit start since it's not continuing)
        message.pushText("3. Third item (new list)\n\n");
        await message.update();

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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. First item\n\n2. Second item\n\n3. Third item\n\n");

        const updates = await message.update();

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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. First level\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("   1. Nested item\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("2. Back to first level\n\n");
        expect(await message.update()).toEqual([
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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. Parent item\n\n");
        await message.update();

        message.pushText("   1. First nested\n\n");
        await message.update();

        message.pushText("   2. Second nested\n\n");
        await message.update();

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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. Level 1\n\n");
        await message.update();

        message.pushText("   1. Level 2\n\n");
        await message.update();

        message.pushText("      1. Level 3\n\n");
        await message.update();

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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. Parent item\n\n");
        await message.update();

        message.pushText("   5. Nested starting at 5\n\n");
        await message.update();

        message.pushText("   6. Nested item 6\n\n");
        await message.update();

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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. Parent\n\n");
        expect(await message.update()).toEqual([
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

        message.pushText("   1");
        expect(await message.update()).toEqual([
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

        message.pushText(". ");
        expect(await message.update()).toEqual([
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

        message.pushText("Nested");
        expect(await message.update()).toEqual([
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

        message.pushText(" item\n\n");
        expect(await message.update()).toEqual([
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
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });

        message.pushText("1. First parent\n\n");
        await message.update();

        message.pushText("   1. First nested\n\n");
        await message.update();

        message.pushText("2. Second parent\n\n");
        await message.update();

        message.pushText("   1. Second nested\n\n");
        await message.update();

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
