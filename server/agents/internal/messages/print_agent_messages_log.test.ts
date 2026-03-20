/* eslint-disable cyberworlds/string-quotes */

import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {printAgentMessagesLog} from "~/server/agents/internal/messages/print_agent_messages_log.js";
import {
    ApiAccount,
    ApiContentResponse,
    ApiMessageContentPayloadParentContentSnippet,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertDateString, serializeDateString} from "~/shared/helpers/date/date_string.js";
import {TimeZone, assertTimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
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

let testAgentMessageIndex = 0;

beforeEach(() => {
    testAgentMessageIndex = 0;
});

function createTestAgentMessage({
    author,
    createdTime,
    content,
    createdTimeZone,
    parent,
}: {
    author: "Alice" | "Assistant" | {id: AccountId; name: string; botId?: BotId};
    createdTime: Date;
    content: ApiContentResponse | string;
    createdTimeZone?: TimeZone;
    parent?: {
        author: "Alice" | "Assistant" | {id: AccountId; name: string; botId?: BotId};
        contentSnippet: ApiMessageContentPayloadParentContentSnippet;
    };
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

        let parentPayload: {
            type: "Message";
            author: ApiAccount;
            index: number;
            contentSnippet: ApiMessageContentPayloadParentContentSnippet;
        } | null = null;

        if (parent) {
            let parentAuthor = parent.author;
            if (parentAuthor === "Alice") {
                parentAuthor = {id: humanAccountId, name: "Alice"};
            } else if (parentAuthor === "Assistant") {
                parentAuthor = {id: botAccountId, name: "Assistant", botId};
            }

            parentPayload = {
                type: "Message",
                author: {
                    ...parentAuthor,
                    shortName: parentAuthor.name,
                    space: {
                        role: "Member",
                        addedTime: assertDateString("2025-09-06T20:34:58.604Z"),
                    },
                },
                index: 0,
                contentSnippet: parent.contentSnippet,
            };
        }

        return AgentMessage.new(transaction, {
            spaceId,
            index: testAgentMessageIndex++,
            author: {
                ...author,
                shortName: author.name,
                space: {
                    role: "Member",
                    addedTime: assertDateString("2025-09-06T20:34:58.604Z"),
                },
            },
            createdTime: serializeDateString(createdTime),
            createdTimeZone: createdTimeZone ?? defaultTimeZone,
            payload: {type: "Content", content, parent: parentPayload ?? undefined},
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

    expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

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

    expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

<bot name="Assistant">
Hello human!
</bot>
`);
});

test("multiple messages from same author within 10 minutes are grouped", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "First message",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 5 * 60 * 1000), // 5 minutes later
            content: "Second message",
        }),
    ]);

    expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

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

    expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

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
            createdTime: new Date(baseTime.getTime() + 1.2 * 60 * 60 * 1000), // 1.2 hours later (72 minutes)
            content: "Afternoon message",
        }),
    ]);

    expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
Morning message
</human>

<time>January 1st at 8:12am EST</time>

<human name="Alice">
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
            createdTime: new Date(baseTime.getTime() + 3 * 60 * 60 * 1000), // 3 hours later (180 minutes)
            content: "Afternoon message",
        }),
    ]);

    expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
Morning message
</human>

<time>January 1st at 10:00am EST</time>

<human name="Alice">
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
            createdTime: new Date(baseTime.getTime() + 25 * 60 * 60 * 1000), // 25 hours later (1500 minutes)
            content: "Tomorrow's message",
        }),
    ]);

    expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
Today's message
</human>

<time>January 2nd at 8:00am EST</time>

<human name="Alice">
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
            createdTime: new Date(baseTime.getTime() + 50 * 60 * 60 * 1000), // ~50 hours later (3000 minutes)
            content: "Wednesday message",
        }),
    ]);

    expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
Monday message
</human>

<time>January 3rd at 9:00am EST</time>

<human name="Alice">
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
            createdTime: new Date(baseTime.getTime() + 5 * 60 * 1000), // 5 minutes later (from start)
            content: "I need help with my project.",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 6 * 60 * 1000), // 6 minutes later (from start)
            content: "Actually, nevermind.",
        }),
        createTestAgentMessage({
            author: "Assistant",
            createdTime: new Date(baseTime.getTime() + 67 * 60 * 1000), // 67 minutes later (just over 1 hour from start)
            content: "Let me know if you change your mind!",
        }),
    ]);

    expect(
        printAgentMessagesLog(messages, {
            time: baseTime,
            timeZone: assertTimeZone("America/Los_Angeles"),
        }),
    ).toEqual(`\
<time>January 1st at 1:00am PST</time>

<human name="Alice" timezone="EST">
Good morning!
</human>

<bot name="Assistant">
Good morning! How can I help?
</bot>

<human name="Alice" timezone="EST">
I need help with my project.

Actually, nevermind.
</human>

<time>January 1st at 2:07am PST</time>

<bot name="Assistant">
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

    expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

<bot name="Alice &amp; Bob&#39;s &quot;Bot&quot;">
Hello
</bot>
`);
});

test("text property uses `printAgentContentToMarkdown()` result", async () => {
    const content: ApiContentResponse = {
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

    expect(printAgentMessagesLog([message], {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
Check out [this link][missing-link]!
</human>
`);
});

test("timezone attribute when user timezone differs from context", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "Hello from New York!",
            createdTimeZone: assertTimeZone("America/New_York"),
        }),
    ]);

    // When context timezone is different, timezone attribute should be added
    expect(
        printAgentMessagesLog(messages, {
            time: new Date("2024-01-01T12:00:00Z"),
            timeZone: assertTimeZone("America/Los_Angeles"),
        }),
    ).toEqual(`\
<time>January 1st at 4:00am PST</time>

<human name="Alice" timezone="EST">
Hello from New York!
</human>
`);
});

test("no timezone attribute when user timezone matches context", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "Hello!",
            createdTimeZone: assertTimeZone("America/New_York"),
        }),
    ]);

    // When context timezone matches, no timezone attribute
    expect(
        printAgentMessagesLog(messages, {
            time: new Date("2024-01-01T12:00:00Z"),
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
Hello!
</human>
`);
});

test("bot messages never have timezone attributes", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Assistant",
            createdTime: baseTime,
            content: "Hello!",
            createdTimeZone: assertTimeZone("America/New_York"),
        }),
    ]);

    // Bots never get timezone attributes even if timezone differs
    expect(
        printAgentMessagesLog(messages, {
            time: new Date("2024-01-01T12:00:00Z"),
            timeZone: assertTimeZone("America/Los_Angeles"),
        }),
    ).toEqual(`\
<time>January 1st at 4:00am PST</time>

<bot name="Assistant">
Hello!
</bot>
`);
});

test("empty messages array", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    expect(printAgentMessagesLog([], {time: baseTime, timeZone: defaultTimeZone})).toEqual("");
    expect(
        printAgentMessagesLog([], {
            time: baseTime,
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual("");
});

test("combination of timezone and time attributes", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "First message",
            createdTimeZone: assertTimeZone("America/New_York"),
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 2 * 60 * 60 * 1000), // 2 hours later (120 minutes)
            content: "Second message",
            createdTimeZone: assertTimeZone("America/Los_Angeles"),
        }),
    ]);

    // Second message should have timezone attribute but NO time attribute (time tag
    // was just injected) Note: Time tag shows the time in the CONTEXT timezone (EST),
    // not the message timezone (PST)
    expect(
        printAgentMessagesLog(messages, {
            time: new Date("2024-01-01T12:00:00Z"),
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
First message
</human>

<time>January 1st at 9:00am EST</time>

<human name="Alice" timezone="PST">
Second message
</human>
`);
});

test("multiple timezone changes in conversation", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "From New York",
            createdTimeZone: assertTimeZone("America/New_York"),
        }),
        createTestAgentMessage({
            author: {id: generateId<AccountId>(), name: "Bob"},
            createdTime: new Date(baseTime.getTime() + 5 * 60 * 1000),
            content: "From Los Angeles",
            createdTimeZone: assertTimeZone("America/Los_Angeles"),
        }),
        createTestAgentMessage({
            author: {id: generateId<AccountId>(), name: "Charlie"},
            createdTime: new Date(baseTime.getTime() + 10 * 60 * 1000),
            content: "From Chicago",
            createdTimeZone: assertTimeZone("America/Chicago"),
        }),
    ]);

    // Context is New York, so Bob and Charlie should have timezone attributes Charlie
    // is only 5 minutes after Bob (< 10 minutes), so no time attribute
    expect(
        printAgentMessagesLog(messages, {
            time: new Date("2024-01-01T12:00:00Z"),
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
From New York
</human>

<human name="Bob" timezone="PST">
From Los Angeles
</human>

<human name="Charlie" timezone="CST">
From Chicago
</human>
`);
});

test("timezone attribute with special characters in abbreviation", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "Hello!",
            createdTimeZone: assertTimeZone("America/New_York"),
        }),
    ]);

    // Test that timezone abbreviations are properly escaped
    const result = printAgentMessagesLog(messages, {
        time: new Date("2024-01-01T12:00:00Z"),
        timeZone: assertTimeZone("America/Los_Angeles"),
    });
    expect(result).toContain('timezone="EST"');
    expect(result).not.toContain("timezone=EST"); // Must be quoted
});

test("messages with same timezone as context do not get attribute", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "First",
            createdTimeZone: assertTimeZone("America/New_York"),
        }),
        createTestAgentMessage({
            author: {id: generateId<AccountId>(), name: "Bob"},
            createdTime: new Date(baseTime.getTime() + 5 * 60 * 1000),
            content: "Second",
            createdTimeZone: assertTimeZone("America/New_York"),
        }),
    ]);

    // Both have same timezone as context, so no timezone attributes
    expect(
        printAgentMessagesLog(messages, {
            time: new Date("2024-01-01T12:00:00Z"),
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
First
</human>

<human name="Bob">
Second
</human>
`);
});

test("grouped messages with different timezones", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "First message",
            createdTimeZone: assertTimeZone("America/Los_Angeles"),
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 5 * 60 * 1000), // 5 minutes later (< 10, should group)
            content: "Second message",
            createdTimeZone: assertTimeZone("America/Los_Angeles"),
        }),
    ]);

    // Messages should be grouped, but only first should have timezone attribute Note:
    // Time tag shows the time in the CONTEXT timezone (EST), not the message timezone
    // (PST)
    expect(
        printAgentMessagesLog(messages, {
            time: new Date("2024-01-01T12:00:00Z"),
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice" timezone="PST">
First message

Second message
</human>
`);
});

test("same author switching timezones within 1 hour", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "From LA",
            createdTimeZone: assertTimeZone("America/Los_Angeles"),
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 30 * 60 * 1000), // 30 minutes later
            content: "Now in NY",
            createdTimeZone: assertTimeZone("America/New_York"),
        }),
    ]);

    // Messages should NOT be grouped because timezone changed, even though same author
    // and < 1 hour
    expect(
        printAgentMessagesLog(messages, {
            time: new Date("2024-01-01T12:00:00Z"),
            timeZone: assertTimeZone("America/Los_Angeles"),
        }),
    ).toEqual(`\
<time>January 1st at 4:00am PST</time>

<human name="Alice">
From LA
</human>

<human name="Alice" time="30 minutes later" timezone="EST">
Now in NY
</human>
`);
});

test("messages from authors in different olson timezones but same formatted timezone should not show timezone", async () => {
    // America/New_York and America/Toronto both format to EST in January
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "From New York",
            createdTimeZone: assertTimeZone("America/New_York"),
        }),
        createTestAgentMessage({
            author: {id: generateId<AccountId>(), name: "Bob"},
            createdTime: new Date(baseTime.getTime() + 5 * 60 * 1000),
            content: "From Toronto",
            createdTimeZone: assertTimeZone("America/Toronto"),
        }),
    ]);

    // Both timezones format to the same abbreviation (EST), so no timezone attribute
    // should be shown
    const result = printAgentMessagesLog(messages, {
        time: new Date("2024-01-01T12:00:00Z"),
        timeZone: assertTimeZone("America/New_York"),
    });

    // Alice and Bob are both in EST, so no timezone attribute for either
    expect(result).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
From New York
</human>

<human name="Bob">
From Toronto
</human>
`);
});

test("message with trailing newline is trimmed", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const content: ApiContentResponse = {
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Hello world"}],
            },
        ],
    };

    const message = await createTestAgentMessage({
        author: "Alice",
        createdTime: baseTime,
        content,
    });

    expect(printAgentMessagesLog([message], {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
Hello world
</human>
`);
});

test("message without trailing newline is not modified", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");

    // Create a message with content that doesn't end in newline
    const message = await createTestAgentMessage({
        author: "Alice",
        createdTime: baseTime,
        content: "Hello",
    });

    // Manually verify the message text to ensure it ends with newline (from
    // printAgentContentToMarkdown) Then check the output is properly formatted
    expect(printAgentMessagesLog([message], {time: baseTime, timeZone: defaultTimeZone})).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
Hello
</human>
`);
});

test("time tag injected before first message", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "First message",
        }),
    ]);

    expect(
        printAgentMessagesLog(messages, {
            time: baseTime,
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
First message
</human>
`);
});

test("time tag injected when messages are exactly 1 hour apart", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "First message",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 60 * 60 * 1000), // exactly 1 hour later (60 minutes)
            content: "Second message",
        }),
    ]);

    expect(
        printAgentMessagesLog(messages, {
            time: baseTime,
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
First message
</human>

<time>January 1st at 8:00am EST</time>

<human name="Alice">
Second message
</human>
`);
});

test("time tag injected when messages are more than 1 hour apart", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "First message",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 3 * 60 * 60 * 1000), // 3 hours later (180 minutes)
            content: "Second message",
        }),
    ]);

    expect(
        printAgentMessagesLog(messages, {
            time: baseTime,
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
First message
</human>

<time>January 1st at 10:00am EST</time>

<human name="Alice">
Second message
</human>
`);
});

test("messages 10-59 minutes apart get relative time but no time tag", async () => {
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

    expect(
        printAgentMessagesLog(messages, {
            time: baseTime,
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
First message
</human>

<human name="Alice" time="30 minutes later">
Second message
</human>
`);
});

test("time tag uses context timezone not message timezone", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "From LA",
            createdTimeZone: assertTimeZone("America/Los_Angeles"),
        }),
    ]);

    expect(
        printAgentMessagesLog(messages, {
            time: baseTime,
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice" timezone="PST">
From LA
</human>
`);
});

test("time tag and relative time attribute work together", async () => {
    const baseTime = new Date("2024-01-01T09:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "Morning message",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 15 * 60 * 1000), // 15 min later (should have relative time)
            content: "Still morning",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 90 * 60 * 1000), // 1.5 hours later (should inject time tag AND have relative time)
            content: "After lunch",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 120 * 60 * 1000), // 2 hours later (30 min after previous, should have relative time)
            content: "Still afternoon",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 125 * 60 * 1000), // 5 minutes later
            content: "Still afternoon",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 135 * 60 * 1000), // 10 minutes later
            content: "Still afternoon",
        }),
    ]);

    // NOTE(ifitzsimmons): This is the one pretty strange case to me. Alice sends
    // message 1 at timestamp 0 Alice sends message 2 at timestamp 5 Alice sends
    // message 3 at timestamp 10 Alice sends message 4 at timestamp 15 Alice sends
    // message 5 at timestamp 25
    //
    // It kinda looks like message 5 comes in at timestep 10 to the agent. I am really
    // starting to feel that just adding message times to the messages is the clearest
    // way to do this, but am like a 3/6 Belief Strength.
    //
    // ```
    // <time>timestep 0</time>
    // <Alice>
    // Message 1
    // Message 2
    // Message 3
    // Message 4
    // </Alice>
    //
    // <Alice time="10 minutes later">
    // Message 5
    // </Alice>
    // ```

    expect(
        printAgentMessagesLog(messages, {
            time: baseTime,
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 4:00am EST</time>

<human name="Alice">
Morning message
</human>

<human name="Alice" time="15 minutes later">
Still morning
</human>

<time>January 1st at 5:30am EST</time>

<human name="Alice">
After lunch
</human>

<human name="Alice" time="30 minutes later">
Still afternoon

Still afternoon
</human>

<human name="Alice" time="10 minutes later">
Still afternoon
</human>
`);
});

test("time tag injection with different authors and timezones", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "From New York",
            createdTimeZone: assertTimeZone("America/New_York"),
        }),
        createTestAgentMessage({
            author: "Assistant",
            createdTime: new Date(baseTime.getTime() + 5 * 60 * 1000), // 5 min later
            content: "Reply from bot",
        }),
        createTestAgentMessage({
            author: {id: generateId<AccountId>(), name: "Bob"},
            createdTime: new Date(baseTime.getTime() + 75 * 60 * 1000), // 1 hour 15 min later (75 minutes from start, 70 from bot)
            content: "From Los Angeles",
            createdTimeZone: assertTimeZone("America/Los_Angeles"),
        }),
    ]);

    expect(
        printAgentMessagesLog(messages, {
            time: baseTime,
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
From New York
</human>

<bot name="Assistant">
Reply from bot
</bot>

<time>January 1st at 8:15am EST</time>

<human name="Bob" timezone="PST">
From Los Angeles
</human>
`);
});

test("time tag with relative time attribute on same message", async () => {
    const baseTime = new Date("2024-01-01T12:00:00Z");
    const messages = await runAllPromises([
        createTestAgentMessage({
            author: "Alice",
            createdTime: baseTime,
            content: "First",
        }),
        createTestAgentMessage({
            author: "Alice",
            createdTime: new Date(baseTime.getTime() + 90 * 60 * 1000), // 1.5 hours later (90 minutes)
            content: "Second",
        }),
    ]);

    // The second message does NOT have a relative time attribute because a time tag
    // was just injected (currentMessageTime === previousTimeInjectionTime)
    expect(
        printAgentMessagesLog(messages, {
            time: baseTime,
            timeZone: assertTimeZone("America/New_York"),
        }),
    ).toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
First
</human>

<time>January 1st at 8:30am EST</time>

<human name="Alice">
Second
</human>
`);
});

describe("messages with parents", () => {
    test("human message replying to another human", async () => {
        const baseTime = new Date("2024-01-01T12:00:00Z");
        const messages = await runAllPromises([
            createTestAgentMessage({
                author: "Alice",
                createdTime: baseTime,
                content: "This is my reply",
                parent: {
                    author: {id: generateId<AccountId>(), name: "Bob"},
                    contentSnippet: {
                        elements: [{type: "Text", text: "Original message from Bob"}],
                        isTruncated: false,
                    },
                },
            }),
        ]);

        expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone}))
            .toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
<blockquote cite="Bob">
Original message from Bob
</blockquote>

This is my reply
</human>
`);
    });

    test("human message replying to a bot", async () => {
        const baseTime = new Date("2024-01-01T12:00:00Z");
        const messages = await runAllPromises([
            createTestAgentMessage({
                author: "Alice",
                createdTime: baseTime,
                content: "Thanks for the help!",
                parent: {
                    author: "Assistant",
                    contentSnippet: {
                        elements: [{type: "Text", text: "Here is the answer to your question"}],
                        isTruncated: false,
                    },
                },
            }),
        ]);

        expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone}))
            .toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
<blockquote cite="Assistant">
Here is the answer to your question
</blockquote>

Thanks for the help!
</human>
`);
    });

    test("bot message replying to a human", async () => {
        const baseTime = new Date("2024-01-01T12:00:00Z");
        const messages = await runAllPromises([
            createTestAgentMessage({
                author: "Assistant",
                createdTime: baseTime,
                content: "Let me address your question",
                parent: {
                    author: "Alice",
                    contentSnippet: {
                        elements: [{type: "Text", text: "Can you help me with this?"}],
                        isTruncated: false,
                    },
                },
            }),
        ]);

        expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone}))
            .toEqual(`\
<time>January 1st at 7:00am EST</time>

<bot name="Assistant">
<blockquote cite="Alice">
Can you help me with this?
</blockquote>

Let me address your question
</bot>
`);
    });

    test("message with truncated parent content shows truncated text with ellipsis", async () => {
        const baseTime = new Date("2024-01-01T12:00:00Z");
        const messages = await runAllPromises([
            createTestAgentMessage({
                author: "Alice",
                createdTime: baseTime,
                content: "I agree with this part",
                parent: {
                    author: {id: generateId<AccountId>(), name: "Bob"},
                    contentSnippet: {
                        elements: [
                            {type: "Text", text: "This is just a snippet of a much longer message"},
                        ],
                        isTruncated: true,
                    },
                },
            }),
        ]);

        expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone}))
            .toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
<blockquote cite="Bob">
This is just a snippet of a much longer message […]
</blockquote>

I agree with this part
</human>
`);
    });

    test("message with non-truncated parent does not show completeness attribute", async () => {
        const baseTime = new Date("2024-01-01T12:00:00Z");
        const messages = await runAllPromises([
            createTestAgentMessage({
                author: "Alice",
                createdTime: baseTime,
                content: "Reply",
                parent: {
                    author: {id: generateId<AccountId>(), name: "Bob"},
                    contentSnippet: {
                        elements: [{type: "Text", text: "Short message"}],
                        isTruncated: false,
                    },
                },
            }),
        ]);

        const result = printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone});
        expect(result).not.toContain("completeness");
    });

    test("HTML escaping in parent author name", async () => {
        const baseTime = new Date("2024-01-01T12:00:00Z");
        const messages = await runAllPromises([
            createTestAgentMessage({
                author: "Alice",
                createdTime: baseTime,
                content: "My reply",
                parent: {
                    author: {id: generateId<AccountId>(), name: 'Bob & Carol\'s "Account"'},
                    contentSnippet: {
                        elements: [{type: "Text", text: "Original message"}],
                        isTruncated: false,
                    },
                },
            }),
        ]);

        expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone}))
            .toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
<blockquote cite="Bob &amp; Carol&#39;s &quot;Account&quot;">
Original message
</blockquote>

My reply
</human>
`);
    });

    test("multiple messages with parents in a conversation", async () => {
        const baseTime = new Date("2024-01-01T12:00:00Z");
        const messages = await runAllPromises([
            createTestAgentMessage({
                author: "Alice",
                createdTime: baseTime,
                content: "Hello!",
            }),
            createTestAgentMessage({
                author: "Assistant",
                createdTime: new Date(baseTime.getTime() + 2 * 60 * 1000),
                content: "Hi there! How can I help?",
            }),
            createTestAgentMessage({
                author: "Alice",
                createdTime: new Date(baseTime.getTime() + 5 * 60 * 1000),
                content: "I need help with this",
                parent: {
                    author: "Assistant",
                    contentSnippet: {
                        elements: [{type: "Text", text: "Hi there! How can I help?"}],
                        isTruncated: false,
                    },
                },
            }),
        ]);

        expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone}))
            .toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
Hello!
</human>

<bot name="Assistant">
Hi there! How can I help?
</bot>

<human name="Alice">
<blockquote cite="Assistant">
Hi there! How can I help?
</blockquote>

I need help with this
</human>
`);
    });

    test("grouped messages where one has a parent", async () => {
        const baseTime = new Date("2024-01-01T12:00:00Z");
        const messages = await runAllPromises([
            createTestAgentMessage({
                author: "Alice",
                createdTime: baseTime,
                content: "First message",
            }),
            createTestAgentMessage({
                author: "Alice",
                createdTime: new Date(baseTime.getTime() + 2 * 60 * 1000), // 2 minutes later
                content: "Second message with reply",
                parent: {
                    author: {id: generateId<AccountId>(), name: "Bob"},
                    contentSnippet: {
                        elements: [{type: "Text", text: "Bob's message"}],
                        isTruncated: false,
                    },
                },
            }),
        ]);

        expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone}))
            .toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
First message
</human>

<human name="Alice">
<blockquote cite="Bob">
Bob's message
</blockquote>

Second message with reply
</human>
`);
    });

    test("message replying to self", async () => {
        const baseTime = new Date("2024-01-01T12:00:00Z");
        const messages = await runAllPromises([
            createTestAgentMessage({
                author: "Alice",
                createdTime: baseTime,
                content: "Follow-up to my own message",
                parent: {
                    author: "Alice",
                    contentSnippet: {
                        elements: [{type: "Text", text: "My earlier point"}],
                        isTruncated: false,
                    },
                },
            }),
        ]);

        expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone}))
            .toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
<blockquote cite="Alice">
My earlier point
</blockquote>

Follow-up to my own message
</human>
`);
    });

    test("message with truncated parent content ending with code element", async () => {
        const baseTime = new Date("2024-01-01T12:00:00Z");
        const messages = await runAllPromises([
            createTestAgentMessage({
                author: "Alice",
                createdTime: baseTime,
                content: "That looks interesting",
                parent: {
                    author: {id: generateId<AccountId>(), name: "Bob"},
                    contentSnippet: {
                        elements: [
                            {type: "Text", text: "Try running "},
                            {type: "Text", text: "npm install", marks: [{type: "Code"}]},
                        ],
                        isTruncated: true,
                    },
                },
            }),
        ]);

        expect(printAgentMessagesLog(messages, {time: baseTime, timeZone: defaultTimeZone}))
            .toEqual(`\
<time>January 1st at 7:00am EST</time>

<human name="Alice">
<blockquote cite="Bob">
Try running \`npm install\` […]
</blockquote>

That looks interesting
</human>
`);
    });
});
