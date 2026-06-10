import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    authorizePostDraftAccess,
    authorizePostDraftAccessIfPossible,
} from "~/server/forum/data/authorize_post_draft_access.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError, UnauthenticatedError} from "~/shared/error/error.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {AccountId, PostDraftId, SpaceId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    forumInjection,
});

async function runTest(
    actionContext: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    draftId: PostDraftId,
) {
    const result = await authorizePostDraftAccessIfPossible(
        actionContext,
        spaceId,
        accountId,
        draftId,
    );

    try {
        await authorizePostDraftAccess(actionContext, spaceId, accountId, draftId);
        expect(result.ok).toEqual(true);
        return null;
    } catch (error) {
        if (error instanceof PermissionDeniedError || error instanceof UnauthenticatedError) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            return error.message;
        } else {
            throw error;
        }
    }
}

test("owner can access their own draft", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const draftId = generateChronologicalId<PostDraftId>();

    expect(await runTest(session.action(), space.id, session.account.id, draftId)).toEqual(null);
});

test("session cannot access another account\u2019s draft", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const draftId = generateChronologicalId<PostDraftId>();

    expect(await runTest(session1.action(), space.id, session2.account.id, draftId)).toEqual(
        "Can\u2019t access drafts from other accounts",
    );
});

test("system actor cannot access drafts", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const draftId = generateChronologicalId<PostDraftId>();

    expect(await runTest(space.systemAction(), space.id, session.account.id, draftId)).toEqual(
        "System actors can\u2019t access post drafts",
    );
});

test("account not in space cannot access drafts", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();
    const draftId = generateChronologicalId<PostDraftId>();

    expect(await runTest(otherSession.action(), space.id, session.account.id, draftId)).toEqual(
        "Account doesn\u2019t have access to space",
    );
});

test("system actor from another space cannot access drafts", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const draftId = generateChronologicalId<PostDraftId>();

    expect(await runTest(otherSpace.systemAction(), space.id, session.account.id, draftId)).toEqual(
        "System actor doesn\u2019t have access to space",
    );
});

test("anonymous actor cannot access drafts", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const draftId = generateChronologicalId<PostDraftId>();

    expect(await runTest(context.anonymousAction(), space.id, session.account.id, draftId)).toEqual(
        "Unauthenticated session",
    );
});

test("impersonated account can access their own draft", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const draftId = generateChronologicalId<PostDraftId>();

    expect(
        await runTest(
            context.impersonatedAccountAction(space.id, session.account.id),
            space.id,
            session.account.id,
            draftId,
        ),
    ).toEqual(null);
});

test("impersonated account from another space cannot access drafts", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const draftId = generateChronologicalId<PostDraftId>();

    expect(
        await runTest(
            context.impersonatedAccountAction(otherSpace.id, session.account.id),
            space.id,
            session.account.id,
            draftId,
        ),
    ).toEqual("Impersonated account actor doesn\u2019t have access to space");
});

test("bot cannot access drafts", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const botAccount = await TestBot.createAndInstantiate(session);
    const draftId = generateChronologicalId<PostDraftId>();

    expect(await runTest(botAccount.action(), space.id, botAccount.id, draftId)).toEqual(
        "Bot account not allowed",
    );
});

test("bot cannot access other account\u2019s drafts", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const botAccount = await TestBot.createAndInstantiate(session);
    const draftId = generateChronologicalId<PostDraftId>();

    expect(await runTest(botAccount.action(), space.id, session.account.id, draftId)).toEqual(
        "Bot account not allowed",
    );
});
