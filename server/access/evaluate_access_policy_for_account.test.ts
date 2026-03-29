import {evaluateAccessPolicyForAccount} from "~/server/access/evaluate_access_policy.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    AccessLevel,
    ResolvedAccessPolicy,
    allAccessLevels,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    chatInjection,
    forumInjection,
});

let scenario: Awaited<ReturnType<typeof createScenario>>;

async function createScenario() {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession();
    const member2Session = await space.createSession();
    const removedSession = await space.createSession();
    await space.removeAccount(removedSession);

    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const neverMemberAccountId = generateId<AccountId>();

    return {
        space,
        memberSession,
        member2Session,
        removedSession,
        otherSession,
        neverMemberAccountId,
    };
}

function createAccessGrant(level: AccessLevel) {
    switch (level) {
        case "View":
            return {level: "View"} as const;
        case "Comment":
            return {level: "Comment"} as const;
        case "Edit":
            return {level: "Edit"} as const;
        case "Manage":
            return {level: "Manage"} as const;
    }
}

function createAccessPolicy({
    defaultGrantLevel = null,
    urlGrant = null,
    accountGrantById = new Map(),
}: {
    defaultGrantLevel?: AccessLevel | null;
    urlGrant?: {level: "View"} | null;
    accountGrantById?: ResolvedAccessPolicy["accountGrantById"];
}): ResolvedAccessPolicy {
    return {
        type: "Local",
        accountGrantById,
        defaultGrant: defaultGrantLevel === null ? null : createAccessGrant(defaultGrantLevel),
        urlGrant,
    };
}

beforeAll(async () => {
    scenario = await createScenario();
});

test("grants view access via URL grant to removed members", async () => {
    const hasAccess = await evaluateAccessPolicyForAccount(
        scenario.space.systemAction(),
        scenario.space.id,
        scenario.removedSession.account.id,
        createAccessPolicy({urlGrant: {level: "View"}}),
        "View",
    );

    expect(hasAccess).toEqual(true);
});

test("grants view access via URL grant to accounts from other spaces", async () => {
    const hasAccess = await evaluateAccessPolicyForAccount(
        scenario.space.systemAction(),
        scenario.space.id,
        scenario.otherSession.account.id,
        createAccessPolicy({urlGrant: {level: "View"}}),
        "View",
    );

    expect(hasAccess).toEqual(true);
});

test("does not grant comment access via URL grant alone", async () => {
    const hasAccess = await evaluateAccessPolicyForAccount(
        scenario.space.systemAction(),
        scenario.space.id,
        scenario.memberSession.account.id,
        createAccessPolicy({urlGrant: {level: "View"}}),
        "Comment",
    );

    expect(hasAccess).toEqual(false);
});

test("continues evaluation when URL grant level is insufficient", async () => {
    const hasAccess = await evaluateAccessPolicyForAccount(
        scenario.space.systemAction(),
        scenario.space.id,
        scenario.memberSession.account.id,
        createAccessPolicy({
            defaultGrantLevel: "Comment",
            urlGrant: {level: "View"},
        }),
        "Comment",
    );

    expect(hasAccess).toEqual(true);
});

test("denies non-members before checking default or account grants", async () => {
    const hasAccess = await evaluateAccessPolicyForAccount(
        scenario.space.systemAction(),
        scenario.space.id,
        scenario.removedSession.account.id,
        createAccessPolicy({
            defaultGrantLevel: "Manage",
            accountGrantById: new Map([
                [scenario.removedSession.account.id, createAccessGrant("Manage")],
            ]),
        }),
        "View",
    );

    expect(hasAccess).toEqual(false);
});

test("denies accounts that were never members", async () => {
    const hasAccess = await evaluateAccessPolicyForAccount(
        scenario.space.systemAction(),
        scenario.space.id,
        scenario.neverMemberAccountId,
        createAccessPolicy({
            defaultGrantLevel: "Manage",
            accountGrantById: new Map([
                [scenario.neverMemberAccountId, createAccessGrant("Manage")],
            ]),
        }),
        "View",
    );

    expect(hasAccess).toEqual(false);
});

for (const defaultGrantLevel of allAccessLevels) {
    for (const expectedAccessLevel of allAccessLevels) {
        test(`default grant at ${defaultGrantLevel} vs expected ${expectedAccessLevel}`, async () => {
            const hasAccess = await evaluateAccessPolicyForAccount(
                scenario.space.systemAction(),
                scenario.space.id,
                scenario.memberSession.account.id,
                createAccessPolicy({
                    defaultGrantLevel,
                }),
                expectedAccessLevel,
            );

            expect(hasAccess).toEqual(hasAccessLevel(defaultGrantLevel, expectedAccessLevel));
        });
    }
}

for (const accountGrantLevel of allAccessLevels) {
    for (const expectedAccessLevel of allAccessLevels) {
        test(`account grant at ${accountGrantLevel} vs expected ${expectedAccessLevel}`, async () => {
            const hasAccess = await evaluateAccessPolicyForAccount(
                scenario.space.systemAction(),
                scenario.space.id,
                scenario.memberSession.account.id,
                createAccessPolicy({
                    accountGrantById: new Map([
                        [scenario.memberSession.account.id, createAccessGrant(accountGrantLevel)],
                    ]),
                }),
                expectedAccessLevel,
            );

            expect(hasAccess).toEqual(hasAccessLevel(accountGrantLevel, expectedAccessLevel));
        });
    }
}

test("does not grant access from grants assigned to a different account", async () => {
    const hasAccess = await evaluateAccessPolicyForAccount(
        scenario.space.systemAction(),
        scenario.space.id,
        scenario.memberSession.account.id,
        createAccessPolicy({
            accountGrantById: new Map([
                [scenario.member2Session.account.id, createAccessGrant("Manage")],
            ]),
        }),
        "View",
    );

    expect(hasAccess).toEqual(false);
});

test("grants access when account grant is higher than default grant", async () => {
    const hasAccess = await evaluateAccessPolicyForAccount(
        scenario.space.systemAction(),
        scenario.space.id,
        scenario.memberSession.account.id,
        createAccessPolicy({
            defaultGrantLevel: "View",
            accountGrantById: new Map([
                [scenario.memberSession.account.id, createAccessGrant("Manage")],
            ]),
        }),
        "Edit",
    );

    expect(hasAccess).toEqual(true);
});

test("denies access when neither default nor account grants are sufficient", async () => {
    const hasAccess = await evaluateAccessPolicyForAccount(
        scenario.space.systemAction(),
        scenario.space.id,
        scenario.memberSession.account.id,
        createAccessPolicy({
            defaultGrantLevel: "View",
            accountGrantById: new Map([
                [scenario.memberSession.account.id, createAccessGrant("Comment")],
            ]),
        }),
        "Manage",
    );

    expect(hasAccess).toEqual(false);
});
