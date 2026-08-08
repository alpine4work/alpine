import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    authorizeInboxAccessForAccount,
    authorizeInboxAccessForAccountIfPossible,
    getEffectiveAccessPolicyForInboxOfAccount,
} from "~/server/notifications/data/authorize_inbox_access_for_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {hasAccessLevel} from "~/shared/access/access_policy.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext({
    chatInjection,
    documentsInjection,
    forumInjection,
    tasksInjection,
});

const viewAndManageInboxAccessLevels = ["View", "Manage"] as const;

describe("getEffectiveAccessPolicyForInboxOfAccount()", () => {
    test("grants Manage only to inbox owner", () => {
        const accountId = generateId<AccountId>();

        expect(getEffectiveAccessPolicyForInboxOfAccount(accountId)).toEqual({
            accountGrantById: new Map([[accountId, {level: "Manage"}]]),
            defaultGrant: null,
            urlGrant: null,
        });
    });

    test("owner Manage grant satisfies `View` access level check", () => {
        const accountId = generateId<AccountId>();
        const policy = getEffectiveAccessPolicyForInboxOfAccount(accountId);

        expect(
            hasAccessLevel(policy.accountGrantById.get(accountId)?.level ?? null, "View"),
        ).toEqual(true);
    });
});

describe("authorizeInboxAccessForAccountIfPossible()", () => {
    describe("session actor", () => {
        for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
            test(`allows \`${expectedAccessLevel}\` access to own inbox`, async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                expect(
                    await authorizeInboxAccessForAccountIfPossible(session.action(), {
                        spaceId: space.id,
                        accountId: session.account.id,
                        expectedAccessLevel,
                    }),
                ).toEqual({
                    ok: true,
                    value: {spaceId: space.id, accountId: session.account.id},
                });
            });
            test(`denies ${expectedAccessLevel} access to a different account inbox`, async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                expect(
                    await authorizeInboxAccessForAccountIfPossible(session1.action(), {
                        spaceId: space.id,
                        accountId: session2.account.id,
                        expectedAccessLevel,
                    }),
                ).toMatchObject({
                    ok: false,
                    error: new PermissionDeniedError(
                        `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                        {
                            aggregateDedupeKey: `${space.id}:${session2.account.id}`,
                        },
                    ),
                });
            });
        }

        for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
            test(`denies access when actor is not a space member (\`${expectedAccessLevel}\`)`, async () => {
                const space1 = await TestSpace.create(context);
                const space2 = await TestSpace.create(context);
                const session = await space2.createSession();

                expect(
                    await authorizeInboxAccessForAccountIfPossible(session.action(), {
                        spaceId: space1.id,
                        accountId: session.account.id,
                        expectedAccessLevel,
                    }),
                ).toMatchObject({
                    ok: false,
                    error: new PermissionDeniedError("Account doesn\u2019t have access to space", {
                        aggregateDedupeKey: `${space1.id}:${session.account.id}`,
                    }),
                });
            });
        }
    });

    describe("system actor", () => {
        for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
            test(`allows \`${expectedAccessLevel}\` access to inbox in the same space`, async () => {
                const space = await TestSpace.create(context);
                const accountId = generateId<AccountId>();

                expect(
                    await authorizeInboxAccessForAccountIfPossible(space.systemAction(), {
                        spaceId: space.id,
                        accountId,
                        expectedAccessLevel,
                    }),
                ).toEqual({ok: true, value: {spaceId: space.id, accountId}});
            });

            test(`denies \`${expectedAccessLevel}\` access to inbox in a different space`, async () => {
                const space = await TestSpace.create(context);
                const otherSpace = await TestSpace.create(context);
                const accountId = generateId<AccountId>();

                expect(
                    await authorizeInboxAccessForAccountIfPossible(otherSpace.systemAction(), {
                        spaceId: space.id,
                        accountId,
                        expectedAccessLevel,
                    }),
                ).toMatchObject({
                    ok: false,
                    error: new PermissionDeniedError(
                        "System actor doesn\u2019t have access to space",
                        {aggregateDedupeKey: space.id},
                    ),
                });
            });
        }
    });

    describe("anonymous actor", () => {
        for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
            test(`denies \`${expectedAccessLevel}\` access`, async () => {
                const space = await TestSpace.create(context);
                const accountId = generateId<AccountId>();

                expect(
                    await authorizeInboxAccessForAccountIfPossible(context.anonymousAction(), {
                        spaceId: space.id,
                        accountId,
                        expectedAccessLevel,
                    }),
                ).toMatchObject({
                    ok: false,
                    error: {message: "Unauthenticated session"},
                });
            });
        }
    });

    describe("impersonated account actor", () => {
        for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
            test(`allows ${expectedAccessLevel} access to own inbox`, async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                expect(
                    await authorizeInboxAccessForAccountIfPossible(
                        space.impersonatedAction(session.account.id),
                        {
                            spaceId: space.id,
                            accountId: session.account.id,
                            expectedAccessLevel,
                        },
                    ),
                ).toEqual({ok: true, value: {spaceId: space.id, accountId: session.account.id}});
            });
            test(`denies ${expectedAccessLevel} access to another member inbox`, async () => {
                const space = await TestSpace.create(context);
                const [session1, session2] = await space.createSessions(2);

                expect(
                    await authorizeInboxAccessForAccountIfPossible(
                        space.impersonatedAction(session1.account.id),
                        {
                            spaceId: space.id,
                            accountId: session2.account.id,
                            expectedAccessLevel,
                        },
                    ),
                ).toMatchObject({
                    ok: false,
                    error: new PermissionDeniedError(
                        `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                        {
                            aggregateDedupeKey: `${space.id}:${session2.account.id}`,
                        },
                    ),
                });
            });
        }

        for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
            test(`denies access when spaceId does not match impersonation space (\`${expectedAccessLevel}\`)`, async () => {
                const space1 = await TestSpace.create(context);
                const space2 = await TestSpace.create(context);
                const session = await space1.createSession();

                expect(
                    await authorizeInboxAccessForAccountIfPossible(
                        space1.impersonatedAction(session.account.id),
                        {
                            spaceId: space2.id,
                            accountId: session.account.id,
                            expectedAccessLevel,
                        },
                    ),
                ).toMatchObject({
                    ok: false,
                    error: new PermissionDeniedError(
                        "Impersonated account actor doesn\u2019t have access to space",
                        {aggregateDedupeKey: space2.id},
                    ),
                });
            });
        }
    });

    describe("bot actor", () => {
        describe("`Account` scope", () => {
            for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
                test(`allows \`${expectedAccessLevel}\` access when scope account matches inbox owner`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action({type: "Account", accountId: session.account.id}),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toEqual({
                        ok: true,
                        value: {spaceId: space.id, accountId: session.account.id},
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when scope account is not the inbox owner`, async () => {
                    const space = await TestSpace.create(context);
                    const session1 = await space.createSession({role: "Admin"});
                    const session2 = await space.createSession();
                    const botAccount = await TestBot.createAndInstantiate(session1);

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action({type: "Account", accountId: session1.account.id}),
                            {
                                spaceId: space.id,
                                accountId: session2.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session2.account.id}`,
                            },
                        ),
                    });
                });
            }
        });

        describe("`Chat` scope", () => {
            for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
                test(`allows \`${expectedAccessLevel}\` access when direct chat only includes inbox owner`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const chat = await TestChat.get(session, botAccount);

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(chat.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toEqual({
                        ok: true,
                        value: {spaceId: space.id, accountId: session.account.id},
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when direct chat includes another account`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const session2 = await space.createSession();
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const chat = await TestChat.get(session, session2, botAccount);

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(chat.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session.account.id}`,
                            },
                        ),
                    });
                });

                test(`allows \`${expectedAccessLevel}\` access when private room policy only includes inbox owner`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const chat = await TestChat.createRoom(session, {access: "Private"});

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(chat.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toEqual({
                        ok: true,
                        value: {spaceId: space.id, accountId: session.account.id},
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when private room grants another account on the room`, async () => {
                    const space = await TestSpace.create(context);
                    const session1 = await space.createSession({role: "Admin"});
                    const session2 = await space.createSession();
                    const botAccount = await TestBot.createAndInstantiate(session1);
                    const chat = await TestChat.createRoom(session1, {access: "Private"});
                    await chat.roomAccess.grantAccounts(session1, [session2]);

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(chat.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session1.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session1.account.id}`,
                            },
                        ),
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when room has urlGrant and no default grant`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const chat = await TestChat.createRoom(session, {
                        access: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: {level: "View"},
                        },
                    });

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(chat.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session.account.id}`,
                            },
                        ),
                    });
                });
            }
        });

        describe("`Document` scope", () => {
            for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
                test(`allows \`${expectedAccessLevel}\` access when document is private to inbox owner`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const document = await TestDocument.create(session, {access: "Private"});

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action({type: "Document", documentId: document.id}),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toEqual({
                        ok: true,
                        value: {spaceId: space.id, accountId: session.account.id},
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when document has space-wide default grant`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const document = await TestDocument.create(session, {access: "Public"});

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action({type: "Document", documentId: document.id}),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session.account.id}`,
                            },
                        ),
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when document lists two accounts and no default grant`, async () => {
                    const space = await TestSpace.create(context);
                    const session1 = await space.createSession({role: "Admin"});
                    const session2 = await space.createSession();
                    const botAccount = await TestBot.createAndInstantiate(session1);
                    const document = await TestDocument.create(session1, {
                        access: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.account.id, {level: "Manage", generation: 0}],
                                [session2.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    });

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action({type: "Document", documentId: document.id}),
                            {
                                spaceId: space.id,
                                accountId: session1.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session1.account.id}`,
                            },
                        ),
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when document has urlGrant and no default grant`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const document = await TestDocument.create(session, {
                        access: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: {level: "View"},
                        },
                    });

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action({type: "Document", documentId: document.id}),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session.account.id}`,
                            },
                        ),
                    });
                });
            }
        });

        describe("`Post` scope", () => {
            for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
                test(`allows \`${expectedAccessLevel}\` access when post channel is private to inbox owner`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const channel = await TestChannel.create(session, {access: "Private"});
                    const post = await channel.createPost(session, "hello");

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(post.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toEqual({
                        ok: true,
                        value: {spaceId: space.id, accountId: session.account.id},
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when post channel has space-wide default grant`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const channel = await TestChannel.create(session, {access: "Public"});
                    const post = await channel.createPost(session, "hello");

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(post.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session.account.id}`,
                            },
                        ),
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when channel lists two accounts and no default grant`, async () => {
                    const space = await TestSpace.create(context);
                    const session1 = await space.createSession({role: "Admin"});
                    const session2 = await space.createSession();
                    const botAccount = await TestBot.createAndInstantiate(session1);
                    const channel = await TestChannel.create(session1, {
                        access: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.account.id, {level: "Manage", generation: 0}],
                                [session2.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    });
                    const post = await channel.createPost(session1, "hello");

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(post.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session1.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session1.account.id}`,
                            },
                        ),
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when channel has urlGrant and no default grant`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const channel = await TestChannel.create(session, {
                        access: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: {level: "View"},
                        },
                    });
                    const post = await channel.createPost(session, "hello");

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(post.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session.account.id}`,
                            },
                        ),
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when channel lists two accounts with mixed levels and no default grant`, async () => {
                    const space = await TestSpace.create(context);
                    const session1 = await space.createSession({role: "Admin"});
                    const session2 = await space.createSession();
                    const botAccount = await TestBot.createAndInstantiate(session1);
                    const channel = await TestChannel.create(session1, {
                        access: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.account.id, {level: "Manage", generation: 0}],
                                [session2.account.id, {level: "View", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    });
                    const post = await channel.createPost(session1, "hello");

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(post.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session1.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session1.account.id}`,
                            },
                        ),
                    });
                });
            }
        });

        describe("`Task` scope", () => {
            for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
                test(`allows \`${expectedAccessLevel}\` access when task only grants inbox owner`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);
                    const task = await TestTask.create(session);

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(task.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toEqual({
                        ok: true,
                        value: {spaceId: space.id, accountId: session.account.id},
                    });
                });

                test(`denies \`${expectedAccessLevel}\` access when task grants another account via assignee`, async () => {
                    const space = await TestSpace.create(context);
                    const session1 = await space.createSession({role: "Admin"});
                    const session2 = await space.createSession();
                    const botAccount = await TestBot.createAndInstantiate(session1);
                    const task = await TestTask.create(session1, {assignee: session2});

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action(task.getBotScope()),
                            {
                                spaceId: space.id,
                                accountId: session1.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session1.account.id}`,
                            },
                        ),
                    });
                });
            }
        });

        describe("`Space` scope", () => {
            for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
                test(`denies \`${expectedAccessLevel}\` access even when inbox owner matches bot space account`, async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession({role: "Admin"});
                    const botAccount = await TestBot.createAndInstantiate(session);

                    expect(
                        await authorizeInboxAccessForAccountIfPossible(
                            botAccount.action({type: "Space"}),
                            {
                                spaceId: space.id,
                                accountId: session.account.id,
                                expectedAccessLevel,
                            },
                        ),
                    ).toMatchObject({
                        ok: false,
                        error: new PermissionDeniedError(
                            `Actor doesn\u2019t have \`${expectedAccessLevel}\` access level`,
                            {
                                aggregateDedupeKey: `${space.id}:${session.account.id}`,
                            },
                        ),
                    });
                });
            }
        });
    });
});

describe("authorizeInboxAccessForAccount()", () => {
    for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
        test(`returns space and account when session can access inbox (\`${expectedAccessLevel}\`)`, async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            expect(
                await authorizeInboxAccessForAccount(session.action(), {
                    spaceId: space.id,
                    accountId: session.account.id,
                    expectedAccessLevel,
                }),
            ).toEqual({spaceId: space.id, accountId: session.account.id});
        });
    }

    for (const expectedAccessLevel of viewAndManageInboxAccessLevels) {
        test(`throws when anonymous (\`${expectedAccessLevel}\`)`, async () => {
            const space = await TestSpace.create(context);
            const accountId = generateId<AccountId>();

            await expect(
                authorizeInboxAccessForAccount(context.anonymousAction(), {
                    spaceId: space.id,
                    accountId,
                    expectedAccessLevel,
                }),
            ).rejects.toThrow("Unauthenticated session");
        });
    }
});
