/* eslint-disable cyberworlds/string-quotes */

import {writeFile} from "fs/promises";
import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {deleteChatMessage} from "~/server/chat/data/chat_messaging.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {
    getSearchDirectChatEntityTitleAndMedia,
    processIndexSearchEntityJob,
} from "~/server/search/data/index/search_entity_index.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
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
`);
});

test("create an empty direct chat", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const setupChat = await TestChat.createRoom(cli.session, {name: "Direct chat setup"});
    await setupChat.sendMessage(aliceSession, "Register Alice for the direct chat test.", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });

    expect(await cli.run("alpine search 'Direct chat setup'")).toEqual(`\
## Chats

1. [**Direct chat setup**](/chat/direct-chat-setup)

## Other

The following results don’t match any natural language filter but Alpine thought they might be relevant anyway. Use your best judgement when determining if they’re actually useful for responding to the user’s request.

1. [Alice: Register Alice for the **direct chat** test.](/chat-message/alice-register-alice-for-the-direct-chat-test)
`);

    expect(await cli.run("alpine read /chat/direct-chat-setup")).toEqual(`\
# Direct chat setup

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Register Alice for the direct chat test.

</message>

End of messages.
`);

    expect(
        await cli.run(`\
alpine create chat 'Chat with [Alice](/human/alice) and [My Bot](/bot/my-bot).

End of messages.'
`),
    ).toEqual(
        expect.stringMatching(
            /^Create was successful\. New chat: \[[^\]]+\]\(\/chat\/[^)]+\)\.\n$/,
        ),
    );
});

test("create a three-member direct chat with an initial message", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const bobSession = await cli.session.space.createSession({name: "Bob"});
    const directCreateBot = await TestBot.createAndInstantiate(cli.session, {
        name: "Direct Create Bot",
    });
    const existingChat = await TestChat.get(aliceSession, bobSession, directCreateBot);

    const directoryChat = await TestChat.createRoom(cli.session, {
        name: "Direct create directory",
    });
    await directoryChat.sendMessage(aliceSession, "Register Alice.", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });
    await directoryChat.sendMessage(bobSession, "Register Bob.", {
        overrideCreatedTime: new Date("2026-05-14T15:05:00.000Z"),
    });
    await directoryChat.sendMessage(directCreateBot, "Register Direct Create Bot.", {
        overrideCreatedTime: new Date("2026-05-14T15:10:00.000Z"),
    });

    expect(await cli.run("alpine search 'Direct create directory'")).toEqual(`\
1. [**Direct create directory**](/chat/direct-create-directory)

2. [**Direct Create** Bot](/bot/direct-create-bot)

3. [Direct: Register **Direct Create** Bot.](/chat-message/direct-register-direct-create-bot)
`);

    expect(await cli.run("alpine read /chat/direct-create-directory")).toEqual(`\
# Direct create directory

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Register Alice.

</message>

<message id="1" from="[Bob](/human/bob)" time="5 minutes later">

Register Bob.

</message>

<message id="2" from="[Direct](/bot/direct-create-bot)" time="5 minutes later">

Register Direct Create Bot.

</message>

End of messages.
`);

    const apiKey = await directCreateBot.createApiKey({
        type: "Chat",
        chatId: existingChat.id,
    });
    await writeFile(`${cli.dataDirectoryPath}/auth.json`, JSON.stringify({apiKey}));

    expect(
        await cli.run(`\
alpine create chat 'Chat with [Alice](/human/alice), [Bob](/human/bob), and [Direct Create Bot](/bot/direct-create-bot).

<message id="0" from="[Direct Create Bot](/bot/direct-create-bot)" timezone="UTC">

Initial direct chat launch message.

</message>

End of messages.'
`),
    ).toEqual(
        expect.stringMatching(
            /^Create was successful\. New chat: \[[^\]]+\]\(\/chat\/[^)]+\)\.\n$/,
        ),
    );

    const createdMessage = await existingChat._getMessage(aliceSession.action(), 0);
    assert(createdMessage.payload.type === "Content");

    expect({
        text: createdMessage.payload.content.doc.textContent,
        createdTimeZone: createdMessage.createdTimeZone,
    }).toEqual({
        text: "Initial direct chat launch message.",
        createdTimeZone: assertTimeZone("UTC"),
    });
});

test("search for and read direct chats with two member states", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const bobSession = await cli.session.space.createSession({name: "Bob"});
    const directBotAccount = await TestBot.createAndInstantiate(cli.session, {
        name: "Direct Bot",
    });

    const oneOnOneChat = await TestChat.get(aliceSession, directBotAccount);
    const parentMessage = await oneOnOneChat.sendMessage(
        aliceSession,
        "Solenodon direct launch question.",
        {overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z")},
    );
    await oneOnOneChat.sendMessage(aliceSession, "Xylophone west coast answer.", {
        parent: parentMessage,
        createdTimeZone: assertTimeZone("America/Los_Angeles"),
        overrideCreatedTime: new Date("2026-05-14T15:05:00.000Z"),
    });

    const groupChat = await TestChat.get(aliceSession, directBotAccount, bobSession);
    await groupChat.sendMessage(bobSession, "Quokka group launch update.", {
        overrideCreatedTime: new Date("2026-05-14T16:00:00.000Z"),
    });

    // Direct messages aren't returned by bot search, so expose the chats through real
    // entity mentions on a public room page before reading their links.
    const directoryChat = await TestChat.createRoom(cli.session, {
        name: "Direct chat directory",
    });
    await directoryChat.sendMessage(
        cli.session,
        `Two-member state: [Direct chat](https://alpine.inc/chat/${oneOnOneChat.id}#mention)

Three-member state: [Group direct chat](https://alpine.inc/chat/${groupChat.id}#mention)`,
        {overrideCreatedTime: new Date("2026-05-14T17:00:00.000Z")},
    );

    expect(await cli.run("alpine search 'Direct chat directory'")).toEqual(`\
## Chats

1. [**Direct chat directory**](/chat/direct-chat-directory)
`);

    expect(await cli.run("alpine read /chat/direct-chat-directory")).toEqual(`\
# Direct chat directory

<time>May 14th at 1:00pm EDT</time>

<message id="0" from="[Anthony](/human/anthony-mose)">

Two-member state: [Private chat](/chat/private-chat)

Three-member state: [Private chat](/chat/private-chat-2)

</message>

End of messages.
`);

    const oneOnOnePath = "/chat/private-chat";
    const groupPath = "/chat/private-chat-2";

    const oneOnOneMetadata = await getSearchDirectChatEntityTitleAndMedia(
        cli.space.systemAction(),
        cli.space.id,
        oneOnOneChat.id,
        new Set(oneOnOneChat.accounts.map(account => account.id)),
    );
    const groupMetadata = await getSearchDirectChatEntityTitleAndMedia(
        cli.space.systemAction(),
        cli.space.id,
        groupChat.id,
        new Set(groupChat.accounts.map(account => account.id)),
    );
    const accountReferenceById = new Map([
        [aliceSession.account.id, "[Alice](/human/alice)"],
        [bobSession.account.id, "[Bob](/human/bob)"],
        [directBotAccount.id, "[Direct Bot](/bot/direct-bot)"],
    ]);
    const oneOnOneMemberReferences = oneOnOneMetadata.sortedAccountIds.map(accountId => {
        const reference = accountReferenceById.get(accountId);
        assert(reference);
        return reference;
    });
    const groupMemberReferences = groupMetadata.sortedAccountIds.map(accountId => {
        const reference = accountReferenceById.get(accountId);
        assert(reference);
        return reference;
    });

    const oneOnOneApiKey = await directBotAccount.createApiKey({
        type: "Chat",
        chatId: oneOnOneChat.id,
    });
    await writeFile(`${cli.dataDirectoryPath}/auth.json`, JSON.stringify({apiKey: oneOnOneApiKey}));
    expect(await cli.run(`alpine read ${oneOnOnePath}`)).toEqual(`\
Chat with ${oneOnOneMemberReferences[0]} and ${oneOnOneMemberReferences[1]}.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Solenodon direct launch question.

</message>

<message id="1" from="[Alice](/human/alice)" time="5 minutes later" timezone="PDT">

<blockquote cite="?message=0">

[Alice](/human/alice): Solenodon direct launch question.

</blockquote>

Xylophone west coast answer.

</message>

End of messages.
`);

    expect(
        await cli.run(`\
alpine update ${oneOnOnePath} --old 'End of messages.' --new '<message timezone="UTC">

Direct chat follow-up from the CLI.

</message>

End of messages.'
`),
    ).toEqual("Update was successful.\n");

    const directAppendedMessage = await oneOnOneChat._getMessage(aliceSession.action(), 2);
    assert(directAppendedMessage.payload.type === "Content");

    const groupApiKey = await directBotAccount.createApiKey({
        type: "Chat",
        chatId: groupChat.id,
    });
    await writeFile(`${cli.dataDirectoryPath}/auth.json`, JSON.stringify({apiKey: groupApiKey}));
    expect(await cli.run(`alpine read ${groupPath}`)).toEqual(`\
Chat with ${groupMemberReferences[0]}, ${groupMemberReferences[1]}, and ${groupMemberReferences[2]}.

<time>May 14th at 12:00pm EDT</time>

<message id="0" from="[Bob](/human/bob)">

Quokka group launch update.

</message>

End of messages.
`);

    expect({
        directAppendedMessageText: directAppendedMessage.payload.content.doc.textContent,
        directAppendedMessageTimeZone: directAppendedMessage.createdTimeZone,
    }).toEqual({
        directAppendedMessageText: "Direct chat follow-up from the CLI.",
        directAppendedMessageTimeZone: assertTimeZone("UTC"),
    });
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
1. [**YouTube empty room**](/chat/youtube-empty-room)
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

    expect(await cli.run("alpine search 'YouTube founders room'")).toEqual(
        expect.stringContaining("[**YouTube founders room**](/chat/youtube-founders-room)"),
    );

    expect(await cli.run("alpine read /chat/youtube-founders-room")).toEqual(`\
# YouTube founders room

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

YouTube was founded by Steve Chen and Jawed Karim.

</message>

End of messages.
`);

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

    expect(await cli.run("alpine search 'YouTube scroll room'")).toEqual(
        expect.stringContaining("[**YouTube scroll room**](/chat/youtube-scroll-room)"),
    );

    expect(await cli.run("alpine read /chat/youtube-scroll-room")).toEqual(`\
# YouTube scroll room

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

First launch update.

</message>

<message id="1" from="[Alice](/human/alice)" time="5 minutes later">

Second launch update.

</message>

End of messages.
`);

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

    expect(await cli.run("alpine search 'YouTube start pagination'")).toEqual(
        expect.stringContaining("[**YouTube start pagination**](/chat/youtube-start-pagination)"),
    );

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

    expect(await cli.run("alpine search 'YouTube end pagination'")).toEqual(
        expect.stringContaining("[**YouTube end pagination**](/chat/youtube-end-pagination)"),
    );

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

    expect(await cli.run("alpine search 'YouTube update room'")).toEqual(
        expect.stringContaining("[**YouTube update room**](/chat/youtube-update-room)"),
    );

    expect(await cli.run("alpine read /chat/youtube-update-room")).toEqual(`\
# YouTube update room

End of messages.
`);

    expect(
        await cli.run(`\
alpine update /chat/youtube-update-room --old 'End of messages.' --new '<message>

I added a launch update from the CLI.

</message>

End of messages.'
`),
    ).toEqual("Update was successful.\n");

    const message = await chat._getMessage(cli.session.action(), 0);
    assert(message.payload.type === "Content");

    expect({
        authorId: message.author.id,
        text: message.payload.content.doc.textContent,
    }).toEqual({
        authorId: expect.any(String),
        text: "I added a launch update from the CLI.",
    });
});

test("rejects creating a message with a deleted attribute", async () => {
    await TestChat.createRoom(cli.session, {name: "Deleted create room"});

    await cli.run("alpine search 'Deleted create room'");
    await cli.run("alpine read /chat/deleted-create-room");

    expect(
        await cli.run(`\
alpine update /chat/deleted-create-room --old 'End of messages.' --new '<message deleted></message>

End of messages.'
`),
    ).toEqual(`\
Error: Couldn’t update \`/chat/deleted-create-room\`. You can’t create a deleted message. Try again without the \`deleted\` attribute.
`);
});

test("only merges adjacent message blocks with the same deletion state", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const chat = await TestChat.createRoom(cli.session, {name: "Deleted merge room"});
    await chat.sendMessage(aliceSession, "Message 0", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });
    const firstDeletedMessage = await chat.sendMessage(aliceSession, "Message 1", {
        overrideCreatedTime: new Date("2026-05-14T15:03:00.000Z"),
    });
    const secondDeletedMessage = await chat.sendMessage(aliceSession, "Message 2", {
        overrideCreatedTime: new Date("2026-05-14T15:06:00.000Z"),
    });
    await chat.sendMessage(aliceSession, "Message 3", {
        overrideCreatedTime: new Date("2026-05-14T15:09:00.000Z"),
    });
    await firstDeletedMessage.delete(aliceSession);
    await secondDeletedMessage.delete(aliceSession);

    await cli.run("alpine search 'Deleted merge room'");

    expect(await cli.run("alpine read /chat/deleted-merge-room")).toEqual(`\
# Deleted merge room

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Message 0

</message>

<message id="1-2" from="[Alice](/human/alice)" deleted></message>

<message id="3" from="[Alice](/human/alice)">

Message 3

</message>

End of messages.
`);
});

test("rejects updating a deleted bot message", async () => {
    const chat = await TestChat.createRoom(cli.session, {name: "Deleted update room"});
    const botAccount = await TestBot.createAndInstantiate(cli.session, {
        name: "Deleted Update Bot",
    });
    const message = await chat.sendMessage(botAccount, "Original bot message", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });
    await deleteChatMessage(botAccount.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const apiKey = await botAccount.createApiKey({type: "Chat", chatId: chat.id});
    await writeFile(`${cli.dataDirectoryPath}/auth.json`, JSON.stringify({apiKey}));
    await cli.run("alpine search 'Deleted update room'");
    await cli.run("alpine read /chat/deleted-update-room");

    expect(
        await cli.run(`\
alpine update /chat/deleted-update-room --old ' deleted' --new ' deleted time="1 minute later"'
`),
    ).toEqual(`\
Error: Couldn’t update \`/chat/deleted-update-room\`. You can’t update the deleted \`<message id="0">\`. Try again without changing the deleted message.
`);
});

test("rejects removing the deleted attribute from a deleted bot message", async () => {
    const chat = await TestChat.createRoom(cli.session, {name: "Deleted attribute room"});
    const botAccount = await TestBot.createAndInstantiate(cli.session, {
        name: "Deleted Attribute Bot",
    });
    const message = await chat.sendMessage(botAccount, "Original bot message", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });
    await deleteChatMessage(botAccount.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const apiKey = await botAccount.createApiKey({type: "Chat", chatId: chat.id});
    await writeFile(`${cli.dataDirectoryPath}/auth.json`, JSON.stringify({apiKey}));
    await cli.run("alpine search 'Deleted attribute room'");
    await cli.run("alpine read /chat/deleted-attribute-room");

    expect(
        await cli.run(`\
alpine update /chat/deleted-attribute-room --old ' deleted' --new ''
`),
    ).toEqual(`\
Error: Couldn’t update \`/chat/deleted-attribute-room\`. You can’t update the deleted \`<message id="0">\`. Try again without changing the deleted message.
`);
});

test("rejects adding a reply while agent message parents are unimplemented", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const chat = await TestChat.createRoom(cli.session, {name: "YouTube reply room"});
    await chat.sendMessage(aliceSession, "The launch checklist is ready.", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });

    expect(await cli.run("alpine search 'YouTube reply room'")).toEqual(
        expect.stringContaining("[**YouTube reply room**](/chat/youtube-reply-room)"),
    );

    expect(await cli.run("alpine read /chat/youtube-reply-room")).toEqual(`\
# YouTube reply room

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

The launch checklist is ready.

</message>

End of messages.
`);

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

test("rejects adding a reply that quotes a deleted message", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const chat = await TestChat.createRoom(cli.session, {name: "Deleted reply room"});
    const deletedMessage = await chat.sendMessage(aliceSession, "Original message", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });
    await deletedMessage.delete(aliceSession);

    await cli.run("alpine search 'Deleted reply room'");
    await cli.run("alpine read /chat/deleted-reply-room");

    expect(
        await cli.run(`\
alpine update /chat/deleted-reply-room --old 'End of messages.' --new '<message>

<blockquote cite="?message=0">

[My Bot](/bot/my-bot): Deleted message

</blockquote>

Replying to the deleted message.

</message>

End of messages.'
`),
    ).toEqual(`\
Error: Couldn’t update \`/chat/deleted-reply-room\`. You can’t quote the deleted \`<message id="0">\`. Try again without the \`<blockquote>\` or quote a message that hasn’t been deleted.
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

    expect(await cli.run("alpine search 'Chat attachment source'")).toEqual(`\
## Chats

1. [YouTube **attachment** room](/chat/youtube-attachment-room)

## Other

The following results don’t match any natural language filter but Alpine thought they might be relevant anyway. Use your best judgement when determining if they’re actually useful for responding to the user’s request.

1. [**Chat attachment source**](/document/chat-attachment-source)

   The **source** image is available below.
`);

    expect(await cli.run("alpine read /document/chat-attachment-source")).toEqual(`\
# Chat attachment source

The source image is available below.

![](/file/image.png)
`);

    expect(await cli.run("alpine search 'YouTube attachment room'")).toEqual(`\
1. [**YouTube attachment room**](/chat/youtube-attachment-room)

2. [Chat **attachment** source](/document/chat-attachment-source)

   The source image is available below.
`);

    expect(await cli.run("alpine read /chat/youtube-attachment-room")).toEqual(`\
# YouTube attachment room

End of messages.
`);

    expect(
        await cli.run(`\
alpine update /chat/youtube-attachment-room --old 'End of messages.' --new '<message timezone="UTC">

I attached the image to this follow-up.

![](/file/image.png)

</message>

End of messages.'
`),
    ).toEqual("Update was successful.\n");

    const message = await chat._getMessage(cli.session.action(), 0);
    assert(message.payload.type === "Content");

    expect(
        (await cli.run("alpine read /chat/youtube-attachment-room")).replace(
            /<time>[^<]+<\/time>/,
            "<time>Generated update time</time>",
        ),
    ).toEqual(`\
# YouTube attachment room

<time>Generated update time</time>

<message id="0" from="[My](/bot/my-bot)">

I attached the image to this follow-up.

![](/file/image.png)

</message>

End of messages.
`);

    expect({
        text: message.payload.content.doc.textContent,
        createdTimeZone: message.createdTimeZone,
        files: message.payload.files.map(messageFile =>
            messageFile.type === "File"
                ? {type: messageFile.type, id: messageFile.file.id}
                : messageFile,
        ),
    }).toEqual({
        text: "I attached the image to this follow-up.",
        createdTimeZone: assertTimeZone("UTC"),
        files: [{type: "File", id: file.id}],
    });
});
