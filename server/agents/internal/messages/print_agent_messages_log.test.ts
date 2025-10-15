/* eslint-disable string-quotes */

import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {printAgentMessagesLog} from "~/server/agents/internal/messages/print_agent_messages_log.js";
import {printAgentContentToMarkdown} from "~/server/agents/internal/print_agent_content_to_markdown.js";
import {ApiContent} from "~/shared/api/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertDateString, serializeDateString} from "~/shared/helpers/date/date_string.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";

const spaceId = generateId<SpaceId>();
const humanAccountId = generateId<AccountId>();
const botId = generateId<BotId>();
const botAccountId = generateId<AccountId>();

const storage = new DurableObjectStorage(new MemoryStorage());

afterEach(async () => {
    await storage.deleteAll();
});

function createTestAgentMessage({
    author,
    createdTime,
    content,
}: {
    author: "Alice" | "Assistant" | {id: AccountId; name: string; botId?: BotId};
    createdTime: Date;
    content: ApiContent | string;
}) {
    return storage.transaction(transaction => {
        if (author === "Alice") {
            author = {id: humanAccountId, name: "Alice"};
        } else if (author === "Assistant") {
            author = {id: botAccountId, name: "Assistant", botId};
        }

        if (typeof content === "string") {
            content = {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: content}],
                    },
                ],
            };
        }

        return AgentMessage.new(transaction, {
            spaceId,
            index: 0,
            author: {
                ...author,
                space: {
                    role: "Member",
                    addedTime: assertDateString("2025-09-06T20:34:58.604Z"),
                },
            },
            createdTime: serializeDateString(createdTime),
            payload: {type: "Content", content},
        });
    });
}

test("single human message", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "Hello world!",
        }),
    ]);

    expect(printAgentMessagesLog(messages)).toEqual(`\
<human name="Alice">
Hello world!
</human>
`);
});

test("single bot message", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Assistant",
            createdTime: baseTime,
            content: "Hello human!",
        }),
    ]);

    expect(printAgentMessagesLog(messages)).toEqual(`\
<bot name="Assistant">
Hello human!
</bot>
`);
});

test("multiple messages from same author within 1 hour", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "First message",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 30 * 60 * 1000), // 30 minutes later
            content: "Second message",
        }),
    ]);

    expect(printAgentMessagesLog(messages)).toEqual(`\
<human name="Alice">
First message

Second message
</human>
`);
});

test("messages from different authors", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "Hello!",
        }),
        createTestAgentMessage({
            author: "Assistant",
            createdTime: new Date(baseTime.getTime() + 5 * 60 * 1000), // 5 minutes later
            content: "Hi there!",
        }),
    ]);

    expect(printAgentMessagesLog(messages)).toEqual(`\
<human name="Alice">
Hello!
</human>

<bot name="Assistant">
Hi there!
</bot>
`);
});

test("messages with time difference in hours", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "Morning message",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 1.2 * 60 * 60 * 1000), // 1.2 hours later
            content: "Afternoon message",
        }),
    ]);

    expect(printAgentMessagesLog(messages)).toEqual(`\
<human name="Alice">
Morning message
</human>

<human name="Alice" time="1 hour later">
Afternoon message
</human>
`);
});

test("messages with time difference in multiple hours", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "Morning message",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 3 * 60 * 60 * 1000), // 3 hours later
            content: "Afternoon message",
        }),
    ]);

    expect(printAgentMessagesLog(messages)).toEqual(`\
<human name="Alice">
Morning message
</human>

<human name="Alice" time="3 hours later">
Afternoon message
</human>
`);
});

test("messages with time difference in days", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "Today's message",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 25 * 60 * 60 * 1000), // 25 hours later
            content: "Tomorrow's message",
        }),
    ]);

    expect(printAgentMessagesLog(messages)).toEqual(`\
<human name="Alice">
Today's message
</human>

<human name="Alice" time="1 day later">
Tomorrow's message
</human>
`);
});

test("messages with time difference in multiple days", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "Monday message",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 50 * 60 * 60 * 1000), // ~50 hours later (2+ days)
            content: "Wednesday message",
        }),
    ]);

    expect(printAgentMessagesLog(messages)).toEqual(`\
<human name="Alice">
Monday message
</human>

<human name="Alice" time="2 days later">
Wednesday message
</human>
`);
});

test("complex conversation with multiple participants and timing", async () => {
    const baseTime = new Date("2024-01-01T09:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "Good morning!",
        }),
        createTestAgentMessage({
            author: "Assistant",
            createdTime: new Date(baseTime.getTime() + 2 * 60 * 1000), // 2 minutes later
            content: "Good morning! How can I help?",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 5 * 60 * 1000), // 5 minutes later
            content: "I need help with my project.",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 6 * 60 * 1000), // 6 minutes later
            content: "Actually, nevermind.",
        }),
        createTestAgentMessage({
            author: "Assistant",
            createdTime: new Date(baseTime.getTime() + 67 * 60 * 1000), // 67 minutes later (just over 1 hour)
            content: "Let me know if you change your mind!",
        }),
    ]);

    expect(printAgentMessagesLog(messages)).toEqual(`\
<human name="Alice">
Good morning!
</human>

<bot name="Assistant">
Good morning! How can I help?
</bot>

<human name="Alice">
I need help with my project.

Actually, nevermind.
</human>

<bot name="Assistant" time="1 hour later">
Let me know if you change your mind!
</bot>
`);
});

test("HTML escaping in author names", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: {id: botAccountId, name: 'Alice & Bob\'s "Bot"', botId},
            createdTime: baseTime,
            content: "Hello",
        }),
    ]);

    expect(printAgentMessagesLog(messages)).toEqual(`\
<bot name="Alice &amp; Bob&#39;s &quot;Bot&quot;">
Hello
</bot>
`);
});

test("text property uses `printAgentContentToMarkdown()` result", async () => {
    const content: ApiContent = {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Check out "},
                    {
                        type: "Text",
                        text: "this link",
                        marks: [{type: "Link", url: "https://example.com"}],
                    },
                    {type: "Text", text: "!"},
                ],
            },
        ],
    };

    const baseTime = new Date("2024-01-01T12:00:00Z");
    const message = await createTestAgentMessage({
        author: "Alice",
        createdTime: baseTime,
        content,
    });

    // Verify that the text property matches what printAgentContentToMarkdown would produce
    const expectedText = await storage.transaction(transaction =>
        printAgentContentToMarkdown(transaction, content, {spaceId}),
    );
    expect(message.text).toEqual(expectedText);
    expect(message.text).toEqual("Check out [this link][missing-link]!\n");

    expect(printAgentMessagesLog([message])).toEqual(`\
<human name="Alice">
Check out [this link][missing-link]!
</human>
`);
});
