import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {getChatMessagePayload} from "~/server/chat/data/chat_messaging.js";
import {FileChatAuthorizer} from "~/server/chat/data/file_chat_authorizer.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";

// TODO pull out reactions from chat_actions.ts to a separate module and update tests here

const context = createTestContext({
    chatInjection,
    notificationsInjection: {
        archiveInboxChatEntryAfterSetChatMessageReaction: async () => {},
    },
});

const testMessageText = "test";
const testMessageEndPost = 6;

test("can add a reaction to a chat comment", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    expect(reactions).toEqual({
        [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"},
    });
});

test("can delete a reaction from a chat comment", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await message.deleteReaction(session2);

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    expect(reactions).toEqual({});
});

test("can delete a reaction from a chat comment with other reactions", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session1, {
        character: {type: "Tree", variant: "Pink"},
        emotion: "Laugh",
    });

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await message.deleteReaction(session2);

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    expect(reactions).toEqual({
        [session1.account.id]: {character: {type: "Tree", variant: "Pink"}, emotion: "Laugh"},
    });
});

test("can add a reaction to a chat file", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.get(session1, session2);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    expect(reactions).toEqual({
        [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"},
    });
});

test("can add a reaction to multiple chat files", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.get(session1, session2);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const file2 = await TestFile.create(session1);
    await file2.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const file3 = await TestFile.create(session1);
    await file3.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {
        files: [file, file2, file3],
    });
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    expect(reactions).toEqual({
        [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"},
    });
});

test("can delete a reaction from a chat file", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.get(session1, session2);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await message.deleteReaction(session2, "Files");

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    expect(reactions).toEqual({});
});

test("can delete a reaction from a chat file with other reactions", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.get(session1, session2);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(
        session1,
        {
            character: {type: "Tree", variant: "Pink"},
            emotion: "Laugh",
        },
        "Files",
    );

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await message.deleteReaction(session2, "Files");

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    expect(reactions).toEqual({
        [session1.account.id]: {character: {type: "Tree", variant: "Pink"}, emotion: "Laugh"},
    });
});

test("can add a default reaction to a chat message", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, "GenericLike");

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    expect(reactions).toEqual({
        [session2.account.id]: "GenericLike",
    });
});

test("can update a reaction to a chat message", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Lolsob",
    });

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    expect(reactions).toEqual({
        [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Lolsob"},
    });
});

test("can update a reaction to a chat message to default reaction", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await message.setReaction(session2, "GenericLike");

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    expect(reactions).toEqual({
        [session2.account.id]: "GenericLike",
    });
});

test("can update a reaction to a chat message from default reaction", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);
    const message = await chat.sendMessage(session1, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, "GenericLike");

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Lolsob",
    });

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    expect(reactions).toEqual({
        [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Lolsob"},
    });
});

test("multiple accounts can react to a chat message", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const chat = await TestChat.get(session1, session2, session3, session4);
    const message = await chat.sendMessage(session1, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await message.setReaction(session3, {
        character: {type: "Yeti", variant: "Blue"},
        emotion: "Yes",
    });

    await message.setReaction(session4, {
        character: {type: "Cat", variant: "Yellow"},
        emotion: "Celebrate",
    });

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    // Use Array.from() to make sure we're asserting they're in the right order.
    expect(Array.from(Object.entries(reactions))).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "Yes"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
    ]);
});

test("updating a reaction preserves the account\u2019s order in the chat message\u2019s reactions", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const chat = await TestChat.get(session1, session2, session3, session4);
    const message = await chat.sendMessage(session1, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await message.setReaction(session3, {
        character: {type: "Yeti", variant: "Blue"},
        emotion: "Yes",
    });

    await message.setReaction(session4, {
        character: {type: "Cat", variant: "Yellow"},
        emotion: "Celebrate",
    });

    await message.setReaction(session3, {
        character: {type: "Yeti", variant: "Blue"},
        emotion: "No",
    });

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    // Use Array.from() to make sure we're asserting they're in the right order.
    expect(Array.from(Object.entries(reactions))).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "No"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
    ]);
});

test("deleting a reaction then adding a new one changes the account\u2019s order in the chat message\u2019s reactions", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);

    const chat = await TestChat.get(session1, session2, session3, session4);
    const message = await chat.sendMessage(session1, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    await message.setReaction(session3, {
        character: {type: "Yeti", variant: "Blue"},
        emotion: "Yes",
    });

    await message.setReaction(session4, {
        character: {type: "Cat", variant: "Yellow"},
        emotion: "Celebrate",
    });

    await message.deleteReaction(session3);

    let messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    let reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    // Use Array.from() to make sure we're asserting they're in the right order.
    expect(Array.from(Object.entries(reactions))).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
    ]);

    await message.setReaction(session3, {
        character: {type: "Yeti", variant: "Blue"},
        emotion: "No",
    });

    messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    // Use Array.from() to make sure we're asserting they're in the right order.
    expect(Array.from(Object.entries(reactions))).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
        [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "No"}],
    ]);
});

test("can have reactions on both text and files", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.get(session1, session2);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Celebrate",
    });

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const textReactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    const fileReactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    expect(textReactions).toEqual({
        [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Celebrate"},
    });

    expect(fileReactions).toEqual({
        [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"},
    });
});

test("can delete a reaction from a file and text reaction remains", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.get(session1, session2);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Celebrate",
    });

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await message.deleteReaction(session2, "Files");

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const textReactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    const fileReactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    expect(textReactions).toEqual({
        [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Celebrate"},
    });

    expect(fileReactions).toEqual({});
});

test("can\u2019t react to chat message actor doesn\u2019t have access to", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const [session1] = await space1.createSessions(1);
    const [session2] = await space2.createSessions(1);

    // Create a chat in space1, session2 from space2 shouldn't have access
    const chat = await TestChat.get(session1);
    const message = await chat.sendMessage(session1, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await expect(
        message.setReaction(session2, {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        }),
    ).rejects.toThrow();
});

test("can react to own chat message", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const chat = await TestChat.get(session);
    const message = await chat.sendMessage(session, testMessageText);
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session, {
        character: {type: "Tree", variant: "Green"},
        emotion: "Laugh",
    });

    const messagePayload = await getChatMessagePayload(session.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (messagePayload.payload.reactionsByPos?.get(testMessageEndPost) ?? emptyReactionSet).get(),
    );

    expect(reactions).toEqual({
        [session.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"},
    });
});

test("can add a default reaction to chat file", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.get(session1, session2);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, "GenericLike", "Files");

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    expect(reactions).toEqual({
        [session2.account.id]: "GenericLike",
    });
});

test("can update a reaction to chat file", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.get(session1, session2);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Lolsob",
        },
        "Files",
    );

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    expect(reactions).toEqual({
        [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Lolsob"},
    });
});

test("can update a reaction to chat file to default reaction", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.get(session1, session2);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await message.setReaction(session2, "GenericLike", "Files");

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    expect(reactions).toEqual({
        [session2.account.id]: "GenericLike",
    });
});

test("can update a reaction to chat file from default reaction", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const chat = await TestChat.get(session1, session2);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(session2, "GenericLike", "Files");

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Lolsob",
        },
        "Files",
    );

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    expect(reactions).toEqual({
        [session2.account.id]: {character: {type: "Tree", variant: "Green"}, emotion: "Lolsob"},
    });
});

test("multiple accounts can react to chat file", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);
    const chat = await TestChat.get(session1, session2, session3, session4);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await message.setReaction(
        session3,
        {
            character: {type: "Yeti", variant: "Blue"},
            emotion: "Yes",
        },
        "Files",
    );

    await message.setReaction(
        session4,
        {
            character: {type: "Cat", variant: "Yellow"},
            emotion: "Celebrate",
        },
        "Files",
    );

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    // Use Array.from() to make sure we're asserting they're in the right order.
    expect(Array.from(Object.entries(reactions))).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "Yes"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
    ]);
});

test("updating a reaction preserves the account\u2019s order in the chat file\u2019s reactions", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);
    const chat = await TestChat.get(session1, session2, session3, session4);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await message.setReaction(
        session3,
        {
            character: {type: "Yeti", variant: "Blue"},
            emotion: "Yes",
        },
        "Files",
    );

    await message.setReaction(
        session4,
        {
            character: {type: "Cat", variant: "Yellow"},
            emotion: "Celebrate",
        },
        "Files",
    );

    await message.setReaction(
        session3,
        {
            character: {type: "Yeti", variant: "Blue"},
            emotion: "No",
        },
        "Files",
    );

    const messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    const reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    // Use Array.from() to make sure we're asserting they're in the right order.
    expect(Array.from(Object.entries(reactions))).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "No"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
    ]);
});

test("deleting a reaction then adding a new one changes the account\u2019s order in the chat file\u2019s reactions", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);
    const chat = await TestChat.get(session1, session2, session3, session4);

    const file = await TestFile.create(session1);
    await file.attach(session1, FileChatAuthorizer.bind({type: "ChatMessages", chatId: chat.id}));
    const message = await chat.sendMessage(session1, testMessageText, {files: [file]});
    await ProcessContextModule.waitForTestTasks();

    await message.setReaction(
        session2,
        {
            character: {type: "Tree", variant: "Green"},
            emotion: "Laugh",
        },
        "Files",
    );

    await message.setReaction(
        session3,
        {
            character: {type: "Yeti", variant: "Blue"},
            emotion: "Yes",
        },
        "Files",
    );

    await message.setReaction(
        session4,
        {
            character: {type: "Cat", variant: "Yellow"},
            emotion: "Celebrate",
        },
        "Files",
    );

    await message.deleteReaction(session3, "Files");

    let messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    let reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    // Use Array.from() to make sure we're asserting they're in the right order.
    expect(Array.from(Object.entries(reactions))).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
    ]);

    await message.setReaction(
        session3,
        {
            character: {type: "Yeti", variant: "Blue"},
            emotion: "No",
        },
        "Files",
    );

    messagePayload = await getChatMessagePayload(session2.action(), {
        chatId: chat.id,
        messageIndex: message.index,
    });

    reactions = Object.fromEntries(
        (
            (messagePayload.payload as MessageContentPayload).filesReactions ?? emptyReactionSet
        ).get(),
    );

    // Use Array.from() to make sure we're asserting they're in the right order.
    expect(Array.from(Object.entries(reactions))).toEqual([
        [session2.account.id, {character: {type: "Tree", variant: "Green"}, emotion: "Laugh"}],
        [session4.account.id, {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"}],
        [session3.account.id, {character: {type: "Yeti", variant: "Blue"}, emotion: "No"}],
    ]);
});
