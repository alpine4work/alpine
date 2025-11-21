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
                                    target: {path: `/documents/${documentId}`},
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
                                    target: {path: `/documents/${documentId}`},
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

    message.pushText("(/document/brown-fox-jumps-over-the");

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
                                    // TODO(ifitzsimmons, #ai): The link hasn't been "closed" yet, so we
                                    // render the "link" as plain text. We'll have to patch the markdown
                                    // parser as some point to handle this case.
                                    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/qtfnrj25qdh092rz074secyvp0
                                    text: "The quick brown fox jumps over the(/document/brown-fox-jumps-over-the",
                                },
                            ],
                        },
                    ],
                },
            },
        },
    ]);

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
                                    target: {path: `/documents/${documentId}`},
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
                                    target: {path: `/documents/${documentId}`},
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

    // TODO(calebmer): This is a bug! The output should still be `test: link`. But
    // I'm running out of time so not fixing this edge case.
    expect(await message.update()).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {type: "Paragraph", elements: [{type: "Text", text: "test: link("}]},
                    ],
                },
            },
        },
    ]);

    message.pushText("http");

    // TODO(calebmer): This is a bug! The output should still be `test: link`. But
    // I'm running out of time so not fixing this edge case.
    expect(await message.update()).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {type: "Paragraph", elements: [{type: "Text", text: "test: link(http"}]},
                    ],
                },
            },
        },
    ]);

    message.pushText("s://example.com");

    expect(await message.update()).toEqual([
        {
            index: 0,
            payload: {
                type: "Content",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "test: link(https://example.com"}],
                        },
                    ],
                },
            },
        },
    ]);

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
