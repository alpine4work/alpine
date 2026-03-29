import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {SitesInjection} from "~/server/context/injection_context_module.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    AccessPolicy,
    LocalAccessPolicy,
    allAccessLevels,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, PostId, SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

// Mutable map that tests can configure for site access policies
const siteAccessPolicies = new Map<SiteId, LocalAccessPolicy>();

const sitesInjection: SitesInjection = {
    dangerouslyGetSiteAccessPolicyWithoutAuthorization: async (_context, siteId) => {
        const policy = siteAccessPolicies.get(siteId);
        if (!policy) {
            throw new FailedPreconditionError(`Site ${siteId} not found in test fixture`);
        }
        return policy;
    },
    getSitePreview: async (_context, siteId) => {
        const policy = siteAccessPolicies.get(siteId);
        if (!policy) {
            throw new FailedPreconditionError(`Site ${siteId} not found in test fixture`);
        }
        return new SitePreviewModel({
            id: siteId,
            spaceId: generateId<SpaceId>(),
            name: "Test Site",
            firstEntityId: null,
            createdTime: new Date(),
            accessPolicy: policy,
            version: 1,
        });
    },
};

const context = createTestContext({
    chatInjection,
    forumInjection,
    sitesInjection,
});

const account1Id = generateId<AccountId>();
const account2Id = generateId<AccountId>();
const account3Id = generateId<AccountId>();
const removedAccountId = generateId<AccountId>();
const bot1AccountId = generateId<AccountId>();
const post1Id = generateId<PostId>();
const post2Id = generateId<PostId>();
const post3Id = generateId<PostId>();
const post4Id = generateId<PostId>();
const post5Id = generateId<PostId>();
const post6Id = generateId<PostId>();

let scenario: Awaited<ReturnType<typeof createScenario>>;

async function createScenario() {
    const bot2 = await TestBot.create(context);

    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const session1 = await space.createSession({id: account1Id});
    const session2 = await space.createSession({id: account2Id, role: "Admin"});
    const session3 = await space.createSession({id: account3Id});
    const removedSession = await space.createSession({id: removedAccountId});
    const otherSession = await otherSpace.createSession({role: "Admin"});

    await otherSpace.addAccount(session1);

    const bot1Account = await TestBot.createAndInstantiate(session2, {
        accountId: bot1AccountId,
    });

    const bot2Account = await bot2.instantiate(session2);
    const bot2OtherAccount = await bot2.instantiate(otherSession);

    const bot3Account = await TestBot.createAndInstantiate(otherSession);

    const channel1 = await TestChannel.create(session1, {access: "Public"});

    const channel2 = await TestChannel.create(session1, {access: "Private"});

    const channel3 = await TestChannel.create(session1, {access: "Private"});
    await channel3.access.grant(session1, session2);

    const channel4 = await TestChannel.create(session1, {access: "Private"});
    await channel4.access.grant(session1, removedSession);

    const channel5 = await TestChannel.create(session1, {access: "Private"});
    await channel5.access.grant(session1, session2);
    await channel5.access.grant(session1, removedSession);

    const channel6 = await TestChannel.create(removedSession, {access: "Private"});

    const chat1 = await TestChat.get(session1, bot1Account);

    const post1 = await channel1.createPost(session1, {id: post1Id});
    const post2 = await channel2.createPost(session1, {id: post2Id});
    const post3 = await channel3.createPost(session1, {id: post3Id});
    const post4 = await channel4.createPost(session1, {id: post4Id});
    const post5 = await channel5.createPost(session1, {id: post5Id});
    const post6 = await channel6.createPost(removedSession, {id: post6Id});

    await space.removeAccount(removedSession);

    return {
        space,
        otherSpace,
        session1,
        session2,
        session3,
        removedSession,
        otherSession,
        bot1Account,
        bot2Account,
        bot2OtherAccount,
        bot3Account,
        channel1,
        channel2,
        channel3,
        post1,
        post2,
        post3,
        post4,
        post5,
        post6,
        chat1,
    };
}

beforeAll(async () => {
    scenario = await createScenario();
});

beforeEach(() => {
    siteAccessPolicies.clear();
});

type TestCase = {
    name: string;
    accessPolicy: LocalAccessPolicy;
};

const testCases: Array<TestCase> = [
    {
        name: "no grants",
        accessPolicy: {
            type: "Local",
            accountGrantById: emptyMap,
            defaultGrant: null,
            urlGrant: null,
        },
    },
    {
        name: "only url grant",
        accessPolicy: {
            type: "Local",
            accountGrantById: emptyMap,
            defaultGrant: null,
            urlGrant: {level: "View"},
        },
    },
    ...allAccessLevels.map(
        (accessLevel): TestCase => ({
            name: quote`only default grant at ${accessLevel} access level`,
            accessPolicy: {
                type: "Local",
                accountGrantById: emptyMap,
                defaultGrant:
                    accessLevel === "Manage"
                        ? {level: "Manage", generation: 0}
                        : {level: accessLevel},
                urlGrant: null,
            },
        }),
    ),
    ...allAccessLevels.map(
        (accessLevel): TestCase => ({
            name: quote`default grant at ${accessLevel} access level and url grant`,
            accessPolicy: {
                type: "Local",
                accountGrantById: emptyMap,
                defaultGrant:
                    accessLevel === "Manage"
                        ? {level: "Manage", generation: 0}
                        : {level: accessLevel},
                urlGrant: {level: "View"},
            },
        }),
    ),
    {
        name: "only one account grant",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[account1Id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    },
    {
        name: "only one account grant (other)",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[account2Id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    },
    {
        name: "only one removed account grant",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[removedAccountId, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    },
    {
        name: "only one bot account grant",
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map([[bot1AccountId, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        },
    },
    ...allAccessLevels.map(
        (accessLevel): TestCase => ({
            name: quote`multiple account grants with one at ${accessLevel} access level`,
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([
                    [account1Id, {level: "Manage", generation: 0}],
                    [
                        account2Id,
                        accessLevel === "Manage"
                            ? {level: "Manage", generation: 1}
                            : {level: accessLevel},
                    ],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        }),
    ),
    ...allAccessLevels.map(
        (accessLevel): TestCase => ({
            name: quote`multiple account grants with one at ${accessLevel} access level (flipped)`,
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([
                    [account2Id, {level: "Manage", generation: 0}],
                    [
                        account1Id,
                        accessLevel === "Manage"
                            ? {level: "Manage", generation: 1}
                            : {level: accessLevel},
                    ],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        }),
    ),
    ...allAccessLevels.map(
        (accessLevel): TestCase => ({
            name: quote`multiple account grants with one removed at ${accessLevel} access level`,
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([
                    [account1Id, {level: "Manage", generation: 0}],
                    [
                        removedAccountId,
                        accessLevel === "Manage"
                            ? {level: "Manage", generation: 1}
                            : {level: accessLevel},
                    ],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        }),
    ),
    ...allAccessLevels.map(
        (accessLevel): TestCase => ({
            name: quote`multiple account grants with one bot at ${accessLevel} access level`,
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([
                    [account1Id, {level: "Manage", generation: 0}],
                    [
                        bot1AccountId,
                        accessLevel === "Manage"
                            ? {level: "Manage", generation: 1}
                            : {level: accessLevel},
                    ],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        }),
    ),
    ...allAccessLevels.map(
        (accessLevel): TestCase => ({
            name: quote`multiple account grants and one is a bot at ${accessLevel} access level`,
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([
                    [account1Id, {level: "Manage", generation: 0}],
                    [
                        bot1AccountId,
                        accessLevel === "Manage"
                            ? {level: "Manage", generation: 1}
                            : {level: accessLevel},
                    ],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        }),
    ),
    ...allAccessLevels.map(
        (accessLevel): TestCase => ({
            name: quote`one account grant and default grant at ${accessLevel} access level`,
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([[account1Id, {level: "Manage", generation: 0}]]),
                defaultGrant:
                    accessLevel === "Manage"
                        ? {level: "Manage", generation: 0}
                        : {level: accessLevel},
                urlGrant: null,
            },
        }),
    ),
    ...allAccessLevels.flatMap(accessLevel1 =>
        allAccessLevels.map(
            (accessLevel2): TestCase => ({
                name: quote`multiple account grants with one at ${accessLevel1} access level and default grant at ${accessLevel2} access level`,
                accessPolicy: {
                    type: "Local",
                    accountGrantById: new Map([
                        [account1Id, {level: "Manage", generation: 0}],
                        [
                            account2Id,
                            accessLevel1 === "Manage"
                                ? {level: "Manage", generation: 1}
                                : {level: accessLevel1},
                        ],
                    ]),
                    defaultGrant:
                        accessLevel2 === "Manage"
                            ? {level: "Manage", generation: 0}
                            : {level: accessLevel2},
                    urlGrant: null,
                },
            }),
        ),
    ),
    ...allAccessLevels.map(
        (accessLevel): TestCase => ({
            name: quote`multiple account grants with one at ${accessLevel} access level and url grant`,
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map([
                    [account1Id, {level: "Manage", generation: 0}],
                    [
                        account2Id,
                        accessLevel === "Manage"
                            ? {level: "Manage", generation: 1}
                            : {level: accessLevel},
                    ],
                ]),
                defaultGrant: null,
                urlGrant: {level: "View"},
            },
        }),
    ),
    ...allAccessLevels.flatMap(accessLevel1 =>
        allAccessLevels.map(
            (accessLevel2): TestCase => ({
                name: quote`multiple account grants with one at ${accessLevel1} access level, default grant at ${accessLevel2} access level, and url grant`,
                accessPolicy: {
                    type: "Local",
                    accountGrantById: new Map([
                        [account1Id, {level: "Manage", generation: 0}],
                        [
                            account2Id,
                            accessLevel1 === "Manage"
                                ? {level: "Manage", generation: 1}
                                : {level: accessLevel1},
                        ],
                    ]),
                    defaultGrant:
                        accessLevel2 === "Manage"
                            ? {level: "Manage", generation: 0}
                            : {level: accessLevel2},
                    urlGrant: {level: "View"},
                },
            }),
        ),
    ),
];

test("bot account has the right `AccountId`", async () => {
    expect(
        await isBotSpaceAccount(scenario.session1.action(), scenario.space.id, bot1AccountId),
    ).toEqual(true);
});

for (const {name: accessPolicyName, accessPolicy} of testCases) {
    for (const expectedAccessLevel of allAccessLevels) {
        test(`anonymous actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    context.anonymousAction(),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(accessPolicy.urlGrant !== null && expectedAccessLevel === "View");
        });

        test(`system actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.space.systemAction(),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(true);
        });

        test(`system actor (from wrong space) with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.otherSpace.systemAction(),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(accessPolicy.urlGrant !== null && expectedAccessLevel === "View");
        });

        test(`session 1 actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.session1.action(),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    hasAccessLevel(
                        accessPolicy.accountGrantById.get(scenario.session1.account.id)?.level ??
                            null,
                        expectedAccessLevel,
                    ),
            );
        });

        test(`session 2 actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.session2.action(),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    hasAccessLevel(
                        accessPolicy.accountGrantById.get(scenario.session2.account.id)?.level ??
                            null,
                        expectedAccessLevel,
                    ),
            );
        });

        test(`session 3 actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.session3.action(),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)),
            );
        });

        test(`removed session actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.removedSession.action(),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(accessPolicy.urlGrant !== null && expectedAccessLevel === "View");
        });

        test(`other session actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.otherSession.action(),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(accessPolicy.urlGrant !== null && expectedAccessLevel === "View");
        });

        test(`impersonated account 1 actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.space.impersonatedAction(scenario.session1),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    hasAccessLevel(
                        accessPolicy.accountGrantById.get(scenario.session1.account.id)?.level ??
                            null,
                        expectedAccessLevel,
                    ),
            );
        });

        test(`impersonated account 2 actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.space.impersonatedAction(scenario.session2),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    hasAccessLevel(
                        accessPolicy.accountGrantById.get(scenario.session2.account.id)?.level ??
                            null,
                        expectedAccessLevel,
                    ),
            );
        });

        test(`impersonated account 3 actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.space.impersonatedAction(scenario.session3),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)),
            );
        });

        test(`impersonated removed account actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.space.impersonatedAction(scenario.removedSession),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(accessPolicy.urlGrant !== null && expectedAccessLevel === "View");
        });

        test(`impersonated account other session actor with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.otherSpace.impersonatedAction(scenario.otherSession),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(accessPolicy.urlGrant !== null && expectedAccessLevel === "View");
        });

        test(`impersonated account 1 actor (from wrong space) with access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.otherSpace.impersonatedAction(scenario.session1),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(accessPolicy.urlGrant !== null && expectedAccessLevel === "View");
        });

        test(`bot 1 actor with space scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot1Account.action({type: "Space"}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)),
            );
        });

        test(`bot 2 actor with space scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot2Account.action({type: "Space"}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)),
            );
        });

        test(`bot 2 actor (other account) with space scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot2OtherAccount.action({type: "Space"}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(accessPolicy.urlGrant !== null && expectedAccessLevel === "View");
        });

        test(`bot 3 actor with space scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot3Account.action({type: "Space"}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(accessPolicy.urlGrant !== null && expectedAccessLevel === "View");
        });

        test(`bot actor with account 1 scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot1Account.action({type: "Account", accountId: account1Id}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    hasAccessLevel(
                        accessPolicy.accountGrantById.get(account1Id)?.level ?? null,
                        expectedAccessLevel,
                    ),
            );
        });

        test(`bot actor with account 2 scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot1Account.action({type: "Account", accountId: account2Id}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    hasAccessLevel(
                        accessPolicy.accountGrantById.get(account2Id)?.level ?? null,
                        expectedAccessLevel,
                    ),
            );
        });

        test(`bot actor with post 1 scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot1Account.action({type: "Post", postId: post1Id}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)),
            );
        });

        test(`bot actor with post 2 scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot1Account.action({type: "Post", postId: post2Id}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    hasAccessLevel(
                        accessPolicy.accountGrantById.get(account1Id)?.level ?? null,
                        expectedAccessLevel,
                    ),
            );
        });

        test(`bot actor with post 3 scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot1Account.action({type: "Post", postId: post3Id}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    (hasAccessLevel(
                        accessPolicy.accountGrantById.get(account1Id)?.level ?? null,
                        expectedAccessLevel,
                    ) &&
                        hasAccessLevel(
                            accessPolicy.accountGrantById.get(account2Id)?.level ?? null,
                            expectedAccessLevel,
                        )),
            );
        });

        test(`bot actor with post 4 scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot1Account.action({type: "Post", postId: post4Id}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    hasAccessLevel(
                        accessPolicy.accountGrantById.get(account1Id)?.level ?? null,
                        expectedAccessLevel,
                    ),
            );
        });

        test(`bot actor with post 5 scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot1Account.action({type: "Post", postId: post5Id}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    (hasAccessLevel(
                        accessPolicy.accountGrantById.get(account1Id)?.level ?? null,
                        expectedAccessLevel,
                    ) &&
                        hasAccessLevel(
                            accessPolicy.accountGrantById.get(account2Id)?.level ?? null,
                            expectedAccessLevel,
                        )),
            );
        });

        test(`bot actor with post 6 scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot1Account.action({type: "Post", postId: post6Id}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    hasAccessLevel(
                        accessPolicy.accountGrantById.get(removedAccountId)?.level ?? null,
                        expectedAccessLevel,
                    ),
            );
        });

        test(`bot actor with chat 1 scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot1Account.action({type: "Chat", chatId: scenario.chat1.id}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    hasAccessLevel(
                        accessPolicy.accountGrantById.get(account1Id)?.level ?? null,
                        expectedAccessLevel,
                    ),
            );
        });

        test(`bot 2 actor with chat 1 scope and access policy: ${accessPolicyName} (expected access level: \`${expectedAccessLevel}\`)`, async () => {
            expect(
                await evaluateAccessPolicy(
                    scenario.bot2Account.action({type: "Chat", chatId: scenario.chat1.id}),
                    scenario.space.id,
                    accessPolicy,
                    expectedAccessLevel,
                ),
            ).toEqual(
                (accessPolicy.urlGrant !== null && expectedAccessLevel === "View") ||
                    (accessPolicy.defaultGrant !== null &&
                        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)) ||
                    hasAccessLevel(
                        accessPolicy.accountGrantById.get(account1Id)?.level ?? null,
                        expectedAccessLevel,
                    ),
            );
        });
    }
}

// =============================================================================
// Site access policy tests
// =============================================================================

describe("site access policy evaluation", () => {
    test("site access policy resolves to the site\u2019s local access policy", async () => {
        const siteId = generateId<SiteId>();

        // Set up site with a specific access policy
        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [scenario.session1.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        });

        const siteAccessPolicy: AccessPolicy = {type: "Site", siteId};

        // Session 1 has explicit Manage access via account grant
        expect(
            await evaluateAccessPolicy(
                scenario.session1.action(),
                scenario.space.id,
                siteAccessPolicy,
                "Manage",
            ),
        ).toEqual(true);

        // Session 2 has View access via default grant
        expect(
            await evaluateAccessPolicy(
                scenario.session2.action(),
                scenario.space.id,
                siteAccessPolicy,
                "View",
            ),
        ).toEqual(true);

        // Session 2 does NOT have Manage access (only View via default)
        expect(
            await evaluateAccessPolicy(
                scenario.session2.action(),
                scenario.space.id,
                siteAccessPolicy,
                "Manage",
            ),
        ).toEqual(false);
    });

    test("account grants in site policies grant access", async () => {
        const siteId = generateId<SiteId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [scenario.session1.account.id, {level: "Manage", generation: 0}],
                [scenario.session2.account.id, {level: "Edit"}],
                [scenario.session3.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        const siteAccessPolicy: AccessPolicy = {type: "Site", siteId};

        // Session 1 has Manage access
        expect(
            await evaluateAccessPolicy(
                scenario.session1.action(),
                scenario.space.id,
                siteAccessPolicy,
                "Manage",
            ),
        ).toEqual(true);

        // Session 2 has Edit access (and View, which is lower)
        expect(
            await evaluateAccessPolicy(
                scenario.session2.action(),
                scenario.space.id,
                siteAccessPolicy,
                "Edit",
            ),
        ).toEqual(true);
        expect(
            await evaluateAccessPolicy(
                scenario.session2.action(),
                scenario.space.id,
                siteAccessPolicy,
                "View",
            ),
        ).toEqual(true);
        expect(
            await evaluateAccessPolicy(
                scenario.session2.action(),
                scenario.space.id,
                siteAccessPolicy,
                "Manage",
            ),
        ).toEqual(false);

        // Session 3 only has View access
        expect(
            await evaluateAccessPolicy(
                scenario.session3.action(),
                scenario.space.id,
                siteAccessPolicy,
                "View",
            ),
        ).toEqual(true);
        expect(
            await evaluateAccessPolicy(
                scenario.session3.action(),
                scenario.space.id,
                siteAccessPolicy,
                "Edit",
            ),
        ).toEqual(false);
    });

    test("default grants in site policies grant access", async () => {
        const siteId = generateId<SiteId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [scenario.session1.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Edit"},
            urlGrant: null,
        });

        const siteAccessPolicy: AccessPolicy = {type: "Site", siteId};

        // Session 2 has no explicit grant but gets Edit via default
        expect(
            await evaluateAccessPolicy(
                scenario.session2.action(),
                scenario.space.id,
                siteAccessPolicy,
                "Edit",
            ),
        ).toEqual(true);
        expect(
            await evaluateAccessPolicy(
                scenario.session2.action(),
                scenario.space.id,
                siteAccessPolicy,
                "View",
            ),
        ).toEqual(true);
        expect(
            await evaluateAccessPolicy(
                scenario.session2.action(),
                scenario.space.id,
                siteAccessPolicy,
                "Manage",
            ),
        ).toEqual(false);
    });

    test("removed accounts don\u2019t get access via site default grant", async () => {
        const siteId = generateId<SiteId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [scenario.session1.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        });

        const siteAccessPolicy: AccessPolicy = {type: "Site", siteId};

        // Removed session should NOT get access even with Manage default grant
        expect(
            await evaluateAccessPolicy(
                scenario.removedSession.action(),
                scenario.space.id,
                siteAccessPolicy,
                "View",
            ),
        ).toEqual(false);
        expect(
            await evaluateAccessPolicy(
                scenario.removedSession.action(),
                scenario.space.id,
                siteAccessPolicy,
                "Edit",
            ),
        ).toEqual(false);
        expect(
            await evaluateAccessPolicy(
                scenario.removedSession.action(),
                scenario.space.id,
                siteAccessPolicy,
                "Manage",
            ),
        ).toEqual(false);
    });

    test("anonymous users only get access via urlGrant (not defaultGrant)", async () => {
        const siteId = generateId<SiteId>();

        // Site with default grant but no URL grant
        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [scenario.session1.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        });

        const siteAccessPolicy: AccessPolicy = {type: "Site", siteId};

        // Anonymous user should NOT get access via default grant
        expect(
            await evaluateAccessPolicy(
                context.anonymousAction(),
                scenario.space.id,
                siteAccessPolicy,
                "View",
            ),
        ).toEqual(false);

        // Now add URL grant
        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [scenario.session1.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: {level: "View"},
        });

        // Anonymous user should get View access via URL grant
        expect(
            await evaluateAccessPolicy(
                context.anonymousAction(),
                scenario.space.id,
                siteAccessPolicy,
                "View",
            ),
        ).toEqual(true);

        // But not higher access levels
        expect(
            await evaluateAccessPolicy(
                context.anonymousAction(),
                scenario.space.id,
                siteAccessPolicy,
                "Edit",
            ),
        ).toEqual(false);
    });

    test("system actor from correct space has full access to site policy", async () => {
        const siteId = generateId<SiteId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [scenario.session1.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        const siteAccessPolicy: AccessPolicy = {type: "Site", siteId};

        // System actor from the correct space has full access
        expect(
            await evaluateAccessPolicy(
                scenario.space.systemAction(),
                scenario.space.id,
                siteAccessPolicy,
                "Manage",
            ),
        ).toEqual(true);

        // System actor from a different space does NOT have access (no URL grant)
        expect(
            await evaluateAccessPolicy(
                scenario.otherSpace.systemAction(),
                scenario.space.id,
                siteAccessPolicy,
                "View",
            ),
        ).toEqual(false);
    });

    test("system actor from wrong space only gets urlGrant access", async () => {
        const siteId = generateId<SiteId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [scenario.session1.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: {level: "View"},
        });

        const siteAccessPolicy: AccessPolicy = {type: "Site", siteId};

        // System actor from wrong space only gets View via URL grant
        expect(
            await evaluateAccessPolicy(
                scenario.otherSpace.systemAction(),
                scenario.space.id,
                siteAccessPolicy,
                "View",
            ),
        ).toEqual(true);
        expect(
            await evaluateAccessPolicy(
                scenario.otherSpace.systemAction(),
                scenario.space.id,
                siteAccessPolicy,
                "Edit",
            ),
        ).toEqual(false);
    });

    test("bot actors with space scope get default grant access in site policy", async () => {
        const siteId = generateId<SiteId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [scenario.session1.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Edit"},
            urlGrant: null,
        });

        const siteAccessPolicy: AccessPolicy = {type: "Site", siteId};

        // Bot with space scope should get Edit access via default grant
        expect(
            await evaluateAccessPolicy(
                scenario.bot1Account.action({type: "Space"}),
                scenario.space.id,
                siteAccessPolicy,
                "Edit",
            ),
        ).toEqual(true);
        expect(
            await evaluateAccessPolicy(
                scenario.bot1Account.action({type: "Space"}),
                scenario.space.id,
                siteAccessPolicy,
                "Manage",
            ),
        ).toEqual(false);
    });

    test("bot actors with account scope inherit account\u2019s site policy access", async () => {
        const siteId = generateId<SiteId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [scenario.session1.account.id, {level: "Manage", generation: 0}],
                [scenario.session2.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        const siteAccessPolicy: AccessPolicy = {type: "Site", siteId};

        // Bot with account 1 scope gets Manage access
        expect(
            await evaluateAccessPolicy(
                scenario.bot1Account.action({type: "Account", accountId: account1Id}),
                scenario.space.id,
                siteAccessPolicy,
                "Manage",
            ),
        ).toEqual(true);

        // Bot with account 2 scope gets Edit access (not Manage)
        expect(
            await evaluateAccessPolicy(
                scenario.bot1Account.action({type: "Account", accountId: account2Id}),
                scenario.space.id,
                siteAccessPolicy,
                "Edit",
            ),
        ).toEqual(true);
        expect(
            await evaluateAccessPolicy(
                scenario.bot1Account.action({type: "Account", accountId: account2Id}),
                scenario.space.id,
                siteAccessPolicy,
                "Manage",
            ),
        ).toEqual(false);
    });

    test("other space session doesn\u2019t get site access even with default grant", async () => {
        const siteId = generateId<SiteId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [scenario.session1.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        });

        const siteAccessPolicy: AccessPolicy = {type: "Site", siteId};

        // Other space session should NOT get access (not a member of this space)
        expect(
            await evaluateAccessPolicy(
                scenario.otherSession.action(),
                scenario.space.id,
                siteAccessPolicy,
                "View",
            ),
        ).toEqual(false);
    });
});
