/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {processIndexSearchEntityJob} from "~/server/search/data/index/search_entity_index.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const cli = setupCliForTest();

// TODO(#agents-web): Implement the room chat creation API endpoint.
test("rejects creating a room chat while the API endpoint is unimplemented", async () => {
    expect(
        await cli.run(`\
alpine create chat '# YouTube launch room

<message id="0" from="[My Bot](/bot/my-bot)">

I opened this room for launch coordination.

</message>

End of messages.'
`),
    ).toEqual(`\
Error: Couldn’t create chat. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Creating room chats from the API isn’t implemented yet
`);
});

test("rejects creating a direct chat with response-only account properties", async () => {
    // TODO(#agents-web): Strip response-only account properties when creating a direct
    // chat.
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const setupChat = await TestChat.createRoom(cli.session, {name: "Direct chat setup"});
    await setupChat.sendMessage(aliceSession, "Register Alice for the direct chat test.");

    await cli.run("alpine search 'Direct chat setup'");
    await cli.run("alpine read /chat/direct-chat-setup");

    expect(
        await cli.run(`\
alpine create chat 'Chat with [Alice](/human/alice) and [My Bot](/bot/my-bot).

<message id="0" from="[My Bot](/bot/my-bot)">

I opened this direct chat for launch coordination.

</message>

End of messages.'
`),
    ).toEqual(`\
Error: Couldn’t create chat. Invalid request body (path: \`#/chat/members/0/account\`).
`);
});

test("search for and read a room chat message", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const chat = await TestChat.createRoom(cli.session, {name: "YouTube moderation room"});
    await chat.sendMessage(aliceSession, "Solenodon moderation blocker.", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });

    expect(await cli.run("alpine search solenodon")).toEqual(`\
1. [Alice: **Solenodon** moderation blocker.](/chat-message/alice-solenodon-moderation-blocker)
`);

    expect(await cli.run("alpine read /chat-message/alice-solenodon-moderation-blocker")).toEqual(`\
# YouTube moderation room

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Solenodon moderation blocker.

</message>

End of messages.
`);
});

test("search for and read an empty room chat", async () => {
    await TestChat.createRoom(cli.session, {name: "YouTube empty room"});

    expect(await cli.run("alpine search 'YouTube empty room'")).toEqual(`\
1. [YouTube empty room](/chat/youtube-empty-room)
`);

    expect(await cli.run("alpine read /chat/youtube-empty-room")).toEqual(`\
# YouTube empty room

End of messages.
`);
});

test("find text in a room chat", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const chat = await TestChat.createRoom(cli.session, {name: "YouTube founders room"});
    await chat.sendMessage(aliceSession, "YouTube was founded by Steve Chen and Jawed Karim.", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });

    await cli.run("alpine search 'YouTube founders room'");
    await cli.run("alpine read /chat/youtube-founders-room");

    expect(
        await cli.run("alpine find /chat/youtube-founders-room 'Jawed Karim' --match-limit=120b"),
    ).toEqual(`\
Found 1 match.

<match>

YouTube was founded by Steve Chen and Jawed Karim.

</message>

End of messages.

(Showing lines 7-11.)

</match>
`);
});

test("scroll a room chat", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const chat = await TestChat.createRoom(cli.session, {name: "YouTube scroll room"});
    await chat.sendMessage(aliceSession, "First launch update.", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });
    await chat.sendMessage(aliceSession, "Second launch update.", {
        overrideCreatedTime: new Date("2026-05-14T15:05:00.000Z"),
    });

    await cli.run("alpine search 'YouTube scroll room'");
    await cli.run("alpine read /chat/youtube-scroll-room");

    expect(await cli.run("alpine scroll /chat/youtube-scroll-room --offset 10")).toEqual(`\
<message id="1" from="[Alice](/human/alice)" time="5 minutes later">

Second launch update.

</message>

End of messages.

(End of file. Showing lines 11-17 of 17.)
`);
});

test("read a room chat from the start and follow its next page", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const chat = await TestChat.createRoom(cli.session, {name: "YouTube start pagination"});

    for (let index = 0; index < 17; index++) {
        await chat.sendMessage(
            aliceSession,
            `Paginated message ${index}. This message has enough detail to make the response require pagination.`,
            {overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5))},
        );
    }

    await cli.run("alpine search 'YouTube start pagination'");

    expect(await cli.run("alpine read '/chat/youtube-start-pagination?start' --limit=1kb"))
        .toEqual(`\
# YouTube start pagination

[Next page »](/chat/youtube-start-pagination?after=4)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Paginated message 0. This message has enough detail to make the response require pagination.

</message>

<message id="1" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 1. This message has enough detail to make the response require pagination.

</message>

<message id="2" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 2. This message has enough detail to make the response require pagination.

</message>

<message id="3" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 3. This message has enough detail to make the response require pagination.

</message>

<message id="4" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 4. This message has enough detail to make the response require pagination.

</message>
`);

    expect(await cli.run("alpine read '/chat/youtube-start-pagination?after=4' --limit=1kb"))
        .toEqual(`\
# YouTube start pagination

[Next page »](/chat/youtube-start-pagination?after=9)

<time>May 14th at 11:25am EDT</time>

<message id="5" from="[Alice](/human/alice)">

Paginated message 5. This message has enough detail to make the response require pagination.

</message>

<message id="6" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 6. This message has enough detail to make the response require pagination.

</message>

<message id="7" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 7. This message has enough detail to make the response require pagination.

</message>

<message id="8" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 8. This message has enough detail to make the response require pagination.

</message>

<message id="9" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 9. This message has enough detail to make the response require pagination.

</message>
`);
});

test("read a room chat from the end and follow its previous page", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const chat = await TestChat.createRoom(cli.session, {name: "YouTube end pagination"});

    for (let index = 0; index < 17; index++) {
        await chat.sendMessage(
            aliceSession,
            `Paginated message ${index}. This message has enough detail to make the response require pagination.`,
            {overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5))},
        );
    }

    await cli.run("alpine search 'YouTube end pagination'");

    expect(await cli.run("alpine read /chat/youtube-end-pagination --limit=1kb")).toEqual(`\
# YouTube end pagination

[Previous page »](/chat/youtube-end-pagination?before=13)

<time>May 14th at 12:05pm EDT</time>

<message id="13" from="[Alice](/human/alice)">

Paginated message 13. This message has enough detail to make the response require pagination.

</message>

<message id="14" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 14. This message has enough detail to make the response require pagination.

</message>

<message id="15" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 15. This message has enough detail to make the response require pagination.

</message>

<message id="16" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 16. This message has enough detail to make the response require pagination.

</message>

End of messages.
`);

    expect(await cli.run("alpine read '/chat/youtube-end-pagination?before=13' --limit=1kb"))
        .toEqual(`\
# YouTube end pagination

[Previous page »](/chat/youtube-end-pagination?before=9)

<time>May 14th at 11:45am EDT</time>

<message id="9" from="[Alice](/human/alice)">

Paginated message 9. This message has enough detail to make the response require pagination.

</message>

<message id="10" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 10. This message has enough detail to make the response require pagination.

</message>

<message id="11" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 11. This message has enough detail to make the response require pagination.

</message>

<message id="12" from="[Alice](/human/alice)" time="5 minutes later">

Paginated message 12. This message has enough detail to make the response require pagination.

</message>
`);
});

test("add a message to a room chat", async () => {
    const chat = await TestChat.createRoom(cli.session, {name: "YouTube update room"});

    await cli.run("alpine search 'YouTube update room'");
    expect(await cli.run("alpine read /chat/youtube-update-room")).toEqual(`\
# YouTube update room

End of messages.
`);

    const updateOutput = await cli.run(`\
alpine update /chat/youtube-update-room --old 'End of messages.' --new '<message>

I added a launch update from the CLI.

</message>

End of messages.'
`);

    const message = await chat._getMessage(cli.session.action(), 0);
    assert(message.payload.type === "Content");

    expect({
        updateOutput,
        authorId: message.author.id,
        text: message.payload.content.doc.textContent,
    }).toEqual({
        updateOutput: "Update was successful.\n",
        authorId: expect.any(String),
        text: "I added a launch update from the CLI.",
    });
});

test("rejects adding a reply while agent message parents are unimplemented", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const chat = await TestChat.createRoom(cli.session, {name: "YouTube reply room"});
    await chat.sendMessage(aliceSession, "The launch checklist is ready.", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });

    await cli.run("alpine search 'YouTube reply room'");
    await cli.run("alpine read /chat/youtube-reply-room");

    expect(
        await cli.run(`\
alpine update /chat/youtube-reply-room --old 'End of messages.' --new '<message>

<blockquote cite="?message=0">

[Alice](/human/alice): The launch checklist is ready.

</blockquote>

I will review it now.

</message>

End of messages.'
`),
    ).toEqual(`\
Error: Couldn’t update \`/chat/youtube-reply-room\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Creating message with parent as agent isn’t implemented yet
`);
});

test("add a message with a file attachment to a room chat", async () => {
    // TODO: Remove the source document once agents can upload files through the API.
    // Until then, it gives the agent a path it can use to reference the file.
    const sourceDocument = await TestDocument.create(cli.session, {
        title: "Chat attachment source",
        body: "The source image is available below.",
        access: "Public",
    });
    const file = await TestFile.create(cli.session);
    await sourceDocument.attachFile(cli.session, file);

    const chat = await TestChat.createRoom(cli.session, {name: "YouTube attachment room"});

    await testTracer.withSpan("Process chat attachment source search job", async span => {
        await processIndexSearchEntityJob(
            cli.space.systemAction(),
            {
                type: "IndexSearchEntity",
                spaceId: sourceDocument.space.id,
                update: {
                    type: "Document",
                    documentId: sourceDocument.id,
                    updatedTraits: {type: "Any"},
                },
            },
            new Date(),
            span,
        );
    });

    await cli.run("alpine search 'Chat attachment source'");
    expect(await cli.run("alpine read /document/chat-attachment-source")).toEqual(`\
# Chat attachment source

The source image is available below.

![](/file/image.png)
`);

    await cli.run("alpine search 'YouTube attachment room'");
    expect(await cli.run("alpine read /chat/youtube-attachment-room")).toEqual(`\
# YouTube attachment room

End of messages.
`);

    const updateOutput = await cli.run(`\
alpine update /chat/youtube-attachment-room --old 'End of messages.' --new '<message>

I attached the image to this follow-up.

![](/file/image.png)

</message>

End of messages.'
`);
    assert(updateOutput === "Update was successful.\n", updateOutput);

    const message = await chat._getMessage(cli.session.action(), 0);
    assert(message.payload.type === "Content");

    expect({
        updateOutput,
        text: message.payload.content.doc.textContent,
        files: message.payload.files.map(messageFile =>
            messageFile.type === "File"
                ? {type: messageFile.type, id: messageFile.file.id}
                : messageFile,
        ),
    }).toEqual({
        updateOutput: "Update was successful.\n",
        text: "I attached the image to this follow-up.",
        files: [{type: "File", id: file.id}],
    });
});
