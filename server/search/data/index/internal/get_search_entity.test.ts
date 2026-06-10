import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createDocument} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {
    getSearchEntity,
    isSearchEntityIndexAccessPolicySubset,
} from "~/server/search/data/index/internal/get_search_entity.js";
import {sitesInjection} from "~/server/sites/data/sites_injection.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {SearchDynamicEntityIdObject} from "~/shared/search/search_entity_id.js";

const context = createTestContext({
    chatInjection,
    sitesInjection,
});

// We should have at least one `getSearchEntity()` test for every search entity
// type. This object will have a TypeScript error whenever a new search entity is
// added reminding developers to add a new test for the search entity.
const testCasesBySearchEntityType: {[Key in SearchDynamicEntityIdObject["type"]]: () => void} = {
    Database: () => {
        // TODO: Add tests for database search entity indexing.
    },
    Account: () => {
        test("can get account search entity", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({name: "Caleb Meredith"});
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Account", accountId: session.account.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set(),
                entity: {
                    id: `Account:${session.account.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: (await session.get()).initialData.space.addedTime,
                    title: "Caleb Meredith",
                    titleVersion: {type: "Integer", version: 0},
                    body: null,
                    tags: [],
                    media: {type: "Account", accountId: session.account.id},
                    embeddingChunks: [],
                    creatorId: null,
                    contributorIds: new Map(),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });
        });
    },
    Document: () => {
        test("can get document search entity", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession();
            const session2 = await space.createSession();
            const session3 = await space.createSession();
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const document = await TestDocument.create(session1, {title: "Lorem Ipsum"});
            await document.access.grantDefault(session1);

            const documentBody =
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque ultricies mattis pharetra. Phasellus pulvinar vitae mauris sed sollicitudin. Vestibulum in tortor vel magna iaculis sagittis. Nunc tempor sodales velit ut posuere. Quisque venenatis bibendum risus ac consequat. Pellentesque ornare mauris nec dolor cursus imperdiet. Sed finibus pellentesque mauris ut dapibus. Duis non lorem lacus.";

            const documentBodyWords = documentBody.split(" ");

            for (let i = 0; i < documentBodyWords.length; i++) {
                await document.type(
                    i % 6 === 0 ? session3 : i % 2 === 0 ? session1 : session2,
                    `${documentBodyWords[i]!} `,
                );
            }

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Document", documentId: document.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set(),
                entity: {
                    id: `Document:${document.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: document.createdTime,
                    title: "Lorem Ipsum",
                    titleVersion: {type: "Integer", version: 55},
                    body: documentBody,
                    tags: [],
                    embeddingChunks: [
                        {
                            preambleEndIndex: 15,
                            text: `# Lorem Ipsum\n\n${documentBody}`,
                            tokenCountWithoutPreamble: 143,
                        },
                    ],
                    media: null,
                    creatorId: session1.account.id,
                    contributorIds: new Map([
                        [session3.account.id, "Minor"],
                        [session2.account.id, "Major"],
                        [session1.account.id, "Major"],
                    ]),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });
        });

        test("bot-created document includes bot as contributor", async () => {
            const space = await TestSpace.create(context);
            const adminSession = await space.createSession({role: "Admin"});
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const botAccount = await TestBot.createAndInstantiate(adminSession);
            const chat = await TestChat.get(adminSession, botAccount);
            const botAction = botAccount.action({type: "Chat", chatId: chat.id});

            const {id: documentId} = await createDocument(botAction, {
                spaceId: space.id,
                creatorId: adminSession.account.id,
            });

            const result = await getSearchEntity(
                space.systemAction(),
                {type: "Document", documentId},
                {tokenizer, registerAdditionalWrite: noop},
            );

            expect(result.entity?.contributorIds).toEqual(
                new Map([
                    [adminSession.account.id, "Minor"],
                    [botAccount.id, "Minor"],
                ]),
            );
        });
    },
    DocumentComment: () => {
        test("can get document comment search entity", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession();
            const session2 = await space.createSession();
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const document = await TestDocument.create(session1, {title: "Test Document"});
            await document.access.grantDefault(session1);

            await document.type(session1, "foo");

            const commentThread = await document.createCommentThread(
                session2,
                {from: 3, to: 6},
                "Test document comment content.",
            );

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {
                        type: "DocumentComment",
                        documentId: document.id,
                        commentThreadId: commentThread.id,
                        commentIndex: 0,
                    },
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set([`Document:${document.id}:Authorization`]),
                entity: {
                    id: `DocumentComment:${document.id}-${commentThread.id}-0`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: expect.any(Date),
                    title: null,
                    titleVersion: null,
                    body: "Test document comment content.",
                    tags: [],
                    embeddingChunks: [
                        {
                            preambleEndIndex: 34,
                            text: "This is a comment on a document:\n\nTest document comment content.",
                            tokenCountWithoutPreamble: 5,
                        },
                    ],
                    media: {type: "Account", accountId: session2.account.id},
                    creatorId: session2.account.id,
                    contributorIds: new Map(),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });
        });
    },
    Channel: () => {
        test("can get channel search entity", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const channel = await TestChannel.create(session, {
                name: "Test Channel",
                description: "Test channel description content.",
            });

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Channel", channelId: channel.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set([]),
                entity: {
                    id: `Channel:${channel.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: channel.createdTime,
                    title: "Test Channel",
                    titleVersion: {type: "Integer", version: 0},
                    body: "Test channel description content.",
                    tags: [],
                    embeddingChunks: [
                        {
                            preambleEndIndex: 16,
                            text: "# Test Channel\n\nTest channel description content.",
                            tokenCountWithoutPreamble: 5,
                        },
                    ],
                    media: null,
                    creatorId: session.account.id,
                    contributorIds: new Map([[session.account.id, "Major"]]),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });
        });

        test("can get channel search entity without description", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const channel = await TestChannel.create(session, {
                name: "Test Channel",
            });

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Channel", channelId: channel.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set([]),
                entity: {
                    id: `Channel:${channel.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: channel.createdTime,
                    title: "Test Channel",
                    titleVersion: {type: "Integer", version: 0},
                    body: "",
                    tags: [],
                    embeddingChunks: [
                        {
                            preambleEndIndex: 34,
                            text: "# Test Channel\n\nThis is a channel.",
                            tokenCountWithoutPreamble: 0,
                        },
                    ],
                    media: null,
                    creatorId: session.account.id,
                    contributorIds: new Map([[session.account.id, "Major"]]),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });
        });
    },
    Post: () => {
        test("can get post search entity", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession();
            const session2 = await space.createSession();
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const channel = await TestChannel.create(session1, {
                name: "Test Channel",
            });

            const post = await channel.createPost(session2, "Test post content.");

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Post", postId: post.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set([
                    `Channel:${channel.id}:Authorization`,
                    `Channel:${channel.id}:Preview`,
                ]),
                entity: {
                    id: `Post:${post.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: post.createdTime,
                    title: "in Test Channel: Test post content",
                    titleVersion: {type: "Integers", versions: [0, 0]},
                    body: "in Test Channel: Test post content.",
                    tags: [],
                    embeddingChunks: [
                        {
                            preambleEndIndex: 47,
                            text: "This is a post in the \u201CTest Channel\u201D channel:\n\nTest post content.",
                            tokenCountWithoutPreamble: 4,
                        },
                    ],
                    media: {type: "Account", accountId: session2.account.id},
                    creatorId: session2.account.id,
                    contributorIds: new Map(),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });
        });
    },
    PostComment: () => {
        test("can get post comment search entity", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession();
            const session2 = await space.createSession();
            const session3 = await space.createSession();
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const channel = await TestChannel.create(session1, {
                name: "Test Channel",
            });

            const post = await channel.createPost(session2, "Test post content.");

            const comment = await post.createComment(session3, "Test post comment content.");

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "PostComment", postId: post.id, commentIndex: 0},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set([`Channel:${channel.id}:Authorization`]),
                entity: {
                    id: `PostComment:${post.id}-0`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: comment.createdTime,
                    title: null,
                    titleVersion: null,
                    body: "Test post comment content.",
                    tags: [],
                    embeddingChunks: [
                        {
                            preambleEndIndex: 30,
                            text: "This is a comment on a post:\n\nTest post comment content.",
                            tokenCountWithoutPreamble: 5,
                        },
                    ],
                    media: {type: "Account", accountId: session3.account.id},
                    creatorId: session3.account.id,
                    contributorIds: new Map(),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });
        });
    },
    Chat: () => {
        test("can\u2019t get 1:1 chat search entity", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({name: "Caleb Meredith"});
            const session2 = await space.createSession({name: "Josh Meredith"});
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const chat = await TestChat.get(session1, session2);

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Chat", chatId: chat.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set(),
                entity: {
                    id: `Chat:${chat.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: null,
                        urlGrantLevel: null,
                    },
                    createdTime: expect.any(Date),
                    title: null,
                    titleVersion: {
                        type: "Integer",
                        version: 0,
                    },
                    body: null,
                    tags: [],
                    embeddingChunks: [],
                    media: null,
                    creatorId: null,
                    contributorIds: new Map(),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });

            await chat.sendMessage(session2, "Test chat message content.");

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Chat", chatId: chat.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set(),
                entity: {
                    id: `Chat:${chat.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: null,
                        urlGrantLevel: null,
                    },
                    createdTime: expect.any(Date),
                    title: null,
                    titleVersion: {
                        type: "Integer",
                        version: 1,
                    },
                    body: null,
                    tags: [],
                    embeddingChunks: [],
                    media: null,
                    creatorId: null,
                    contributorIds: new Map(),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });
        });

        test("can get chat search entity", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({name: "Caleb Meredith"});
            const session2 = await space.createSession({name: "Josh Meredith"});
            const session3 = await space.createSession({name: "Shawn Meredith"});
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const chat = await TestChat.get(session1, session2, session3);

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Chat", chatId: chat.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set(),
                entity: {
                    id: `Chat:${chat.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: null,
                        urlGrantLevel: null,
                    },
                    createdTime: expect.any(Date),
                    title: null,
                    titleVersion: {
                        type: "Integer",
                        version: 0,
                    },
                    body: null,
                    tags: [],
                    embeddingChunks: [],
                    media: null,
                    creatorId: null,
                    contributorIds: new Map(),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });

            await chat.sendMessage(session2, "Test chat message content.");

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Chat", chatId: chat.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set(
                    [
                        `Account:${session1.account.id}:WithoutSpace`,
                        `Account:${session2.account.id}:WithoutSpace`,
                        `Account:${session3.account.id}:WithoutSpace`,
                    ].sort(defaultCompareStrings),
                ),
                entity: {
                    id: `Chat:${chat.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(
                            [session1.account.id, session2.account.id, session3.account.id].sort(
                                defaultCompareStrings,
                            ),
                        ),
                        defaultGrantType: null,
                        urlGrantLevel: null,
                    },
                    createdTime: expect.any(Date),
                    title: "Caleb Meredith, Josh Meredith, and Shawn Meredith",
                    titleVersion: {
                        type: "Integer",
                        version: 1,
                    },
                    body: null,
                    tags: [],
                    embeddingChunks: [],
                    media: {
                        type: "AccountPile",
                        accountCount: 3,
                        previewAccountIds: expect.arrayContaining([
                            session1.account.id,
                            session2.account.id,
                            session3.account.id,
                        ]),
                    },
                    creatorId: null,
                    contributorIds: new Map([
                        [session1.account.id, "Major"],
                        [session2.account.id, "Major"],
                        [session3.account.id, "Major"],
                    ]),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });
        });
    },
    ChatMessage: () => {
        test("can get chat message comment search entity", async () => {
            const space = await TestSpace.create(context);
            const session1 = await space.createSession({name: "Caleb Meredith"});
            const session2 = await space.createSession({name: "Josh Meredith"});
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const chat = await TestChat.get(session1, session2);

            const message = await chat.sendMessage(session2, "Test chat message content.");

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "ChatMessage", chatId: chat.id, messageIndex: 0},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set([`Chat:${chat.id}:Definition`]),
                entity: {
                    id: `ChatMessage:${chat.id}-0`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(
                            [session1.account.id, session2.account.id].sort(defaultCompareStrings),
                        ),
                        defaultGrantType: null,
                        urlGrantLevel: null,
                    },
                    createdTime: message.createdTime,
                    title: null,
                    titleVersion: null,
                    body: "Test chat message content.",
                    tags: [],
                    embeddingChunks: [
                        {
                            preambleEndIndex: 49,
                            text: "This is a message in a chat between two people:\n\nTest chat message content.",
                            tokenCountWithoutPreamble: 5,
                        },
                    ],
                    media: {type: "Account", accountId: session2.account.id},
                    creatorId: session2.account.id,
                    contributorIds: new Map(),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });
        });
    },
    Task: () => {
        // Our `getSearchEntity()` tests for tasks are in
        // `search_entity_index_tasks.test.ts` because we don't want to start OpenSearch in
        // this test.
    },
    TaskCollection: () => {
        // Our `getSearchEntity()` tests for tasks are in
        // `search_entity_index_tasks.test.ts` because we don't want to start OpenSearch in
        // this test.
    },
    TaskComment: () => {
        // Our `getSearchEntity()` tests for tasks are in
        // `search_entity_index_tasks.test.ts` because we don't want to start OpenSearch in
        // this test.
    },
    Site: () => {
        test("can get site search entity", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

            const site = await TestSite.create(session, {
                name: "Project X Wiki",
                access: "Public",
            });

            expect(
                await getSearchEntity(
                    space.systemAction(),
                    {type: "Site", siteId: site.id},
                    {tokenizer, registerAdditionalWrite: noop},
                ),
            ).toEqual({
                dependencyIds: new Set(),
                entity: {
                    id: `Site:${site.id}`,
                    accessPolicy: {
                        accountGrantAccountIds: new Set(),
                        defaultGrantType: "Space",
                        urlGrantLevel: null,
                    },
                    createdTime: expect.any(Date),
                    title: "Project X Wiki",
                    titleVersion: {type: "Integer", version: 0},
                    body: null,
                    tags: [],
                    embeddingChunks: [],
                    media: {
                        type: "Site",
                        firstEntityId: null,
                    },
                    creatorId: session.account.id,
                    contributorIds: new Map(),
                    priority: null,
                    openness: null,
                    activeness: null,
                    assigneeId: null,
                    dueDate: null,
                },
            });
        });
    },
};

for (const testCases of Object.values(testCasesBySearchEntityType)) {
    testCases();
}

test("can check if one access policy is a subset of another", () => {
    const account1Id = generateId<AccountId>();
    const account2Id = generateId<AccountId>();
    const account3Id = generateId<AccountId>();
    const account4Id = generateId<AccountId>();

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account2Id, account3Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id, account3Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account2Id, account3Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account2Id, account3Id, account1Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account3Id, account4Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id, account3Id, account4Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account3Id, account4Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account3Id, account4Id, account3Id, account4Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account3Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account3Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(false);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account2Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);

    expect(
        isSearchEntityIndexAccessPolicySubset(
            {
                accountGrantAccountIds: new Set([account3Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
            {
                accountGrantAccountIds: new Set([account1Id, account2Id]),
                defaultGrantType: "Space",
                urlGrantLevel: null,
            },
        ),
    ).toEqual(true);
});
