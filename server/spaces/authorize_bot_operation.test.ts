import {createBotForTest} from "~/server/bots/test_helpers/create_bot_for_test.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    authorizeBotCreation,
    authorizeBotOperation,
    getAllowedBotOperations,
    hasBotOperationAccess,
    hasBotOperationAccessForBot,
} from "~/server/spaces/authorize_bot_operation.js";
import {installBotInSpace} from "~/server/spaces/install_bot_in_space.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {BotOperation, BotOperationType} from "~/shared/bots/bot_operation.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection: {internalGetUpdateOurAccountNameTaskTransactionEntries: () => []},
});

let scenario: Awaited<ReturnType<typeof createScenario>>;

beforeAll(async () => {
    scenario = await createScenario();
});

/**
 * Every test only reads authorization state, so the suite shares one scenario. The
 * admin belongs to both spaces to distinguish an owner-space mismatch from a role
 * failure when installing a space-owned bot.
 */
async function createScenario() {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const [ownerSession, memberSession, adminSession, internalSession, outsiderSession] =
        await runAllPromises([
            space.createSession({role: "Member"}),
            space.createSession({role: "Member"}),
            space.createSession({role: "Admin"}),
            space.createSession({role: "Member", hasInternalAccess: true}),
            otherSpace.createSession({role: "Member"}),
        ]);

    await otherSpace.addAccount(adminSession, "Admin");

    const [
        accountBot,
        ownerSecondAccountBot,
        memberAccountBot,
        spaceBot,
        otherSpaceBot,
        systemBot,
    ] = await runAllPromises([
        createBotForTest(context, {
            name: "Account Bot",
            webhook: null,
            ownerEntity: {type: "Account", accountId: ownerSession.account.id},
        }),
        createBotForTest(context, {
            name: "Owner Second Account Bot",
            webhook: null,
            ownerEntity: {type: "Account", accountId: ownerSession.account.id},
        }),
        createBotForTest(context, {
            name: "Member Account Bot",
            webhook: null,
            ownerEntity: {type: "Account", accountId: memberSession.account.id},
        }),
        createBotForTest(context, {
            name: "Space Bot",
            webhook: null,
            ownerEntity: {type: "Space", spaceId: space.id},
        }),
        createBotForTest(context, {
            name: "Other Space Bot",
            webhook: null,
            ownerEntity: {type: "Space", spaceId: otherSpace.id},
        }),
        createBotForTest(context, {
            name: "System Bot",
            webhook: null,
            ownerEntity: {type: "System"},
        }),
    ]);

    const [accountBotAccount, spaceBotAccount] = await runAllPromises([
        installBotInSpace(ownerSession.action(), {
            spaceId: space.id,
            botId: accountBot.id,
        }),
        installBotInSpace(adminSession.action(), {
            spaceId: space.id,
            botId: spaceBot.id,
        }),
    ]);

    return {
        space,
        otherSpace,
        ownerSession,
        memberSession,
        adminSession,
        internalSession,
        outsiderSession,
        accountBotId: accountBot.id,
        ownerSecondAccountBotId: ownerSecondAccountBot.id,
        memberAccountBotId: memberAccountBot.id,
        spaceBotId: spaceBot.id,
        otherSpaceBotId: otherSpaceBot.id,
        systemBotId: systemBot.id,
        accountBotAction: () => context.botAction(space.id, accountBotAccount.id, {type: "Space"}),
        spaceBotAction: () => context.botAction(space.id, spaceBotAccount.id, {type: "Space"}),
        nonBotAccountAction: () =>
            context.botAction(space.id, memberSession.account.id, {type: "Space"}),
    };
}

type OperationAccessTestCase = {
    readonly name: string;
    readonly action: () => ServerActionContext;
    readonly botId: () => BotId;
    readonly operation: () => BotOperation;
    readonly expected: boolean;
};

function defineOperationAccessTestCases(testCases: ReadonlyArray<OperationAccessTestCase>) {
    for (const {name, action, botId, operation, expected} of testCases) {
        test(`${name}`, async () => {
            const hasAccess = await hasBotOperationAccess(action(), botId(), operation());

            expect(hasAccess).toBe(expected);
        });
    }
}

describe("hasBotOperationAccess()", () => {
    test("returns false when the bot does not exist", async () => {
        const hasAccess = await hasBotOperationAccess(
            scenario.ownerSession.action(),
            generateId<BotId>(),
            {type: "View"},
        );

        expect(hasAccess).toBe(false);
    });

    describe("account-owned bot", () => {
        defineOperationAccessTestCases([
            {
                name: "allows the owner to view it",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({type: "View"}),
                expected: true,
            },
            {
                name: "allows the owner to message it",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({type: "Message", spaceId: scenario.otherSpace.id}),
                expected: true,
            },
            {
                name: "allows the owner to manage it",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({type: "Manage"}),
                expected: true,
            },
            {
                name: "allows the owner to view its space settings",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ViewSpaceSettings",
                    spaceId: scenario.otherSpace.id,
                }),
                expected: true,
            },
            {
                name: "allows the owner to manage its space settings",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ManageSpaceSettings",
                    spaceId: scenario.otherSpace.id,
                }),
                expected: true,
            },
            {
                name: "allows the owner to view settings for their own account",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.ownerSession.account.id,
                }),
                expected: true,
            },
            {
                name: "prevents the owner from viewing settings in a space they are not a member of",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.ownerSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents the owner from managing settings in a space they are not a member of",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ManageSpaceSettingsForActor",
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.ownerSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents the owner from viewing settings for another account",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: false,
            },
            {
                name: "allows the owner to manage settings for their own account",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ManageSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.ownerSession.account.id,
                }),
                expected: true,
            },
            {
                name: "prevents the owner from managing settings for another account",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ManageSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: false,
            },
            {
                name: "allows the owner to install it in a space where they are a member",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({type: "Install", spaceId: scenario.space.id}),
                expected: true,
            },
            {
                name: "prevents the owner from installing it in a space where they are not a member",
                action: () => scenario.ownerSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({type: "Install", spaceId: scenario.otherSpace.id}),
                expected: false,
            },
            {
                name: "allows an impersonated owner to manage it",
                action: () => scenario.space.impersonatedAction(scenario.ownerSession),
                botId: () => scenario.accountBotId,
                operation: () => ({type: "Manage"}),
                expected: true,
            },
            {
                name: "allows an impersonated owner to install it in their space",
                action: () => scenario.space.impersonatedAction(scenario.ownerSession),
                botId: () => scenario.accountBotId,
                operation: () => ({type: "Install", spaceId: scenario.space.id}),
                expected: true,
            },
            {
                name: "prevents another account from viewing it",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({type: "View"}),
                expected: false,
            },
            {
                name: "prevents another account from managing the owner\u2019s settings",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ManageSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.ownerSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents another account from installing it",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({type: "Install", spaceId: scenario.space.id}),
                expected: false,
            },
            {
                name: "prevents an anonymous actor from messaging it",
                action: () => context.anonymousAction(),
                botId: () => scenario.accountBotId,
                operation: () => ({type: "Message", spaceId: scenario.space.id}),
                expected: false,
            },
            {
                name: "prevents another account from viewing its space settings",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ViewSpaceSettings",
                    spaceId: scenario.space.id,
                }),
                expected: false,
            },
            {
                name: "prevents a system actor from managing it",
                action: () => scenario.space.systemAction(),
                botId: () => scenario.accountBotId,
                operation: () => ({type: "Manage"}),
                expected: false,
            },
        ]);
    });

    describe("space-owned bot", () => {
        defineOperationAccessTestCases([
            {
                name: "allows a member of the owning space to view it",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "View"}),
                expected: true,
            },
            {
                name: "allows a member of the owning space to message it",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "Message", spaceId: scenario.space.id}),
                expected: true,
            },
            {
                name: "prevents a non-member from viewing it",
                action: () => scenario.outsiderSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "View"}),
                expected: false,
            },
            {
                name: "prevents an anonymous actor from messaging it",
                action: () => context.anonymousAction(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "Message", spaceId: scenario.space.id}),
                expected: false,
            },
            {
                name: "allows a member to view its space settings",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({
                    type: "ViewSpaceSettings",
                    spaceId: scenario.space.id,
                }),
                expected: true,
            },
            {
                name: "prevents a member from viewing its settings in another space",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({
                    type: "ViewSpaceSettings",
                    spaceId: scenario.otherSpace.id,
                }),
                expected: false,
            },
            {
                name: "allows a member to view settings for their own account",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: true,
            },
            {
                name: "prevents a member from viewing settings for another account",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.ownerSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents a non-member from viewing settings for their own account",
                action: () => scenario.outsiderSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.outsiderSession.account.id,
                }),
                expected: false,
            },
            {
                name: "allows a member to manage settings for their own account",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({
                    type: "ManageSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: true,
            },
            {
                name: "prevents a member from managing settings for another account",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({
                    type: "ManageSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.ownerSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents a non-member from managing settings for their own account",
                action: () => scenario.outsiderSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({
                    type: "ManageSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.outsiderSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents a member from managing it",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "Manage"}),
                expected: false,
            },
            {
                name: "allows an admin to manage it",
                action: () => scenario.adminSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "Manage"}),
                expected: true,
            },
            {
                name: "prevents a member from managing its space settings",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({
                    type: "ManageSpaceSettings",
                    spaceId: scenario.space.id,
                }),
                expected: false,
            },
            {
                name: "allows an admin to manage its space settings",
                action: () => scenario.adminSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({
                    type: "ManageSpaceSettings",
                    spaceId: scenario.space.id,
                }),
                expected: true,
            },
            {
                name: "prevents a member from installing it",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "Install", spaceId: scenario.space.id}),
                expected: false,
            },
            {
                name: "allows an admin to install it in the owning space",
                action: () => scenario.adminSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "Install", spaceId: scenario.space.id}),
                expected: true,
            },
            {
                name: "prevents an admin from installing it in another space they administer",
                action: () => scenario.adminSession.action(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "Install", spaceId: scenario.otherSpace.id}),
                expected: false,
            },
            {
                name: "allows a system actor scoped to the owning space to manage it",
                action: () => scenario.space.systemAction(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "Manage"}),
                expected: true,
            },
            {
                name: "prevents a system actor scoped to another space from viewing it",
                action: () => scenario.otherSpace.systemAction(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "View"}),
                expected: false,
            },
        ]);
    });

    describe("system-owned bot", () => {
        defineOperationAccessTestCases([
            {
                name: "allows an anonymous actor to view it",
                action: () => context.anonymousAction(),
                botId: () => scenario.systemBotId,
                operation: () => ({type: "View"}),
                expected: true,
            },
            {
                name: "allows an anonymous actor to message it",
                action: () => context.anonymousAction(),
                botId: () => scenario.systemBotId,
                operation: () => ({type: "Message", spaceId: scenario.space.id}),
                expected: true,
            },
            {
                name: "allows a member to view its space settings",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ViewSpaceSettings",
                    spaceId: scenario.space.id,
                }),
                expected: true,
            },
            {
                name: "prevents a non-member from viewing its space settings",
                action: () => scenario.outsiderSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ViewSpaceSettings",
                    spaceId: scenario.space.id,
                }),
                expected: false,
            },
            {
                name: "prevents an account without internal access from managing it",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({type: "Manage"}),
                expected: false,
            },
            {
                name: "allows an account with internal access to manage it",
                action: () => scenario.internalSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({type: "Manage"}),
                expected: true,
            },
            {
                name: "allows an impersonated internal account to manage it",
                action: () => scenario.space.impersonatedAction(scenario.internalSession),
                botId: () => scenario.systemBotId,
                operation: () => ({type: "Manage"}),
                expected: true,
            },
            {
                name: "prevents a system actor from managing it",
                action: () => scenario.space.systemAction(),
                botId: () => scenario.systemBotId,
                operation: () => ({type: "Manage"}),
                expected: false,
            },
            {
                name: "prevents a member from installing it",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({type: "Install", spaceId: scenario.space.id}),
                expected: false,
            },
            {
                name: "allows an admin to install it",
                action: () => scenario.adminSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({type: "Install", spaceId: scenario.space.id}),
                expected: true,
            },
            {
                name: "prevents a member from managing its space settings",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ManageSpaceSettings",
                    spaceId: scenario.space.id,
                }),
                expected: false,
            },
            {
                name: "allows an admin to manage its space settings",
                action: () => scenario.adminSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ManageSpaceSettings",
                    spaceId: scenario.space.id,
                }),
                expected: true,
            },
            {
                name: "allows an account to view its own settings",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: true,
            },
            {
                name: "prevents an account from viewing its own settings in a space it is not in",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents an account from managing its own settings in a space it is not in",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ManageSpaceSettingsForActor",
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents an account from viewing another account settings",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.ownerSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents an anonymous actor from viewing account settings",
                action: () => context.anonymousAction(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: false,
            },
            {
                name: "allows an account to manage its own settings",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ManageSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: true,
            },
            {
                name: "prevents an account from managing another account\u2019s settings",
                action: () => scenario.memberSession.action(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ManageSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.ownerSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents an anonymous actor from managing account settings",
                action: () => context.anonymousAction(),
                botId: () => scenario.systemBotId,
                operation: () => ({
                    type: "ManageSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: false,
            },
        ]);
    });

    describe("bot actor", () => {
        defineOperationAccessTestCases([
            {
                name: "allows it to view a bot owned by the same account",
                action: () => scenario.accountBotAction(),
                botId: () => scenario.ownerSecondAccountBotId,
                operation: () => ({type: "View"}),
                expected: true,
            },
            {
                name: "prevents it from viewing a bot owned by another account",
                action: () => scenario.accountBotAction(),
                botId: () => scenario.memberAccountBotId,
                operation: () => ({type: "View"}),
                expected: false,
            },
            {
                name: "allows it to message a bot owned by its space",
                action: () => scenario.accountBotAction(),
                botId: () => scenario.spaceBotId,
                operation: () => ({type: "Message", spaceId: scenario.space.id}),
                expected: true,
            },
            {
                name: "allows it to message a system-owned bot",
                action: () => scenario.spaceBotAction(),
                botId: () => scenario.systemBotId,
                operation: () => ({type: "Message", spaceId: scenario.space.id}),
                expected: true,
            },
            {
                name: "allows it to view its shared space settings",
                action: () => scenario.accountBotAction(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ViewSpaceSettings",
                    spaceId: scenario.space.id,
                }),
                expected: true,
            },
            {
                name: "allows it to view its own settings for any account in the space",
                action: () => scenario.accountBotAction(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: true,
            },
            {
                name: "prevents it from viewing another bot settings for an account",
                action: () => scenario.accountBotAction(),
                botId: () => scenario.ownerSecondAccountBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.space.id,
                    accountId: scenario.memberSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents it from viewing its account settings in another space",
                action: () => scenario.accountBotAction(),
                botId: () => scenario.accountBotId,
                operation: () => ({
                    type: "ViewSpaceSettingsForActor",
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.outsiderSession.account.id,
                }),
                expected: false,
            },
            {
                name: "prevents it from managing another bot",
                action: () => scenario.accountBotAction(),
                botId: () => scenario.ownerSecondAccountBotId,
                operation: () => ({type: "Manage"}),
                expected: false,
            },
            {
                name: "returns false when its space account is not a bot account",
                action: () => scenario.nonBotAccountAction(),
                botId: () => scenario.systemBotId,
                operation: () => ({type: "View"}),
                expected: false,
            },
            {
                name: "returns false when the target bot does not exist",
                action: () => scenario.accountBotAction(),
                botId: () => generateId<BotId>(),
                operation: () => ({type: "View"}),
                expected: false,
            },
        ]);
    });
});

describe("hasBotOperationAccessForBot()", () => {
    type BotAccessTestCase = {
        readonly name: string;
        readonly operation: () => BotOperation;
        readonly actorBotId: () => BotId;
        readonly botId: () => BotId;
        readonly spaceId: () => typeof scenario.space.id;
        readonly expected: boolean;
    };

    const testCases: ReadonlyArray<BotAccessTestCase> = [
        {
            name: "allows View for bots owned by the same account",
            operation: () => ({type: "View"}),
            actorBotId: () => scenario.accountBotId,
            botId: () => scenario.ownerSecondAccountBotId,
            spaceId: () => scenario.space.id,
            expected: true,
        },
        {
            name: "prevents View for bots owned by different accounts",
            operation: () => ({type: "View"}),
            actorBotId: () => scenario.accountBotId,
            botId: () => scenario.memberAccountBotId,
            spaceId: () => scenario.space.id,
            expected: false,
        },
        {
            name: "prevents a space-owned bot from viewing an account-owned bot",
            operation: () => ({type: "View"}),
            actorBotId: () => scenario.spaceBotId,
            botId: () => scenario.accountBotId,
            spaceId: () => scenario.space.id,
            expected: false,
        },
        {
            name: "allows Message for a bot owned by the acting space",
            operation: () => ({type: "Message", spaceId: scenario.space.id}),
            actorBotId: () => scenario.accountBotId,
            botId: () => scenario.spaceBotId,
            spaceId: () => scenario.space.id,
            expected: true,
        },
        {
            name: "prevents Message for a bot owned by another space",
            operation: () => ({type: "Message", spaceId: scenario.space.id}),
            actorBotId: () => scenario.accountBotId,
            botId: () => scenario.otherSpaceBotId,
            spaceId: () => scenario.space.id,
            expected: false,
        },
        {
            name: "allows View for a system-owned bot",
            operation: () => ({type: "View"}),
            actorBotId: () => scenario.accountBotId,
            botId: () => scenario.systemBotId,
            spaceId: () => scenario.space.id,
            expected: true,
        },
        {
            name: "allows a system-owned bot to view a bot owned by the acting space",
            operation: () => ({type: "View"}),
            actorBotId: () => scenario.systemBotId,
            botId: () => scenario.spaceBotId,
            spaceId: () => scenario.space.id,
            expected: true,
        },
        {
            name: "allows a bot to view its shared space settings",
            operation: () => ({type: "ViewSpaceSettings", spaceId: scenario.space.id}),
            actorBotId: () => scenario.accountBotId,
            botId: () => scenario.accountBotId,
            spaceId: () => scenario.space.id,
            expected: true,
        },
        {
            name: "allows a bot to view its own settings for another account",
            operation: () => ({
                type: "ViewSpaceSettingsForActor",
                spaceId: scenario.space.id,
                accountId: scenario.memberSession.account.id,
            }),
            actorBotId: () => scenario.accountBotId,
            botId: () => scenario.accountBotId,
            spaceId: () => scenario.space.id,
            expected: true,
        },
        {
            name: "prevents a bot from viewing another bot settings for an account",
            operation: () => ({
                type: "ViewSpaceSettingsForActor",
                spaceId: scenario.space.id,
                accountId: scenario.memberSession.account.id,
            }),
            actorBotId: () => scenario.accountBotId,
            botId: () => scenario.ownerSecondAccountBotId,
            spaceId: () => scenario.space.id,
            expected: false,
        },
        {
            name: "prevents a bot from viewing its account settings in another space",
            operation: () => ({
                type: "ViewSpaceSettingsForActor",
                spaceId: scenario.otherSpace.id,
                accountId: scenario.outsiderSession.account.id,
            }),
            actorBotId: () => scenario.accountBotId,
            botId: () => scenario.accountBotId,
            spaceId: () => scenario.space.id,
            expected: false,
        },
        {
            name: "prevents operations outside the allowed read operations",
            operation: () => ({type: "Manage"}),
            actorBotId: () => scenario.accountBotId,
            botId: () => scenario.ownerSecondAccountBotId,
            spaceId: () => scenario.space.id,
            expected: false,
        },
        {
            name: "returns false when the acting bot does not exist",
            operation: () => ({type: "View"}),
            actorBotId: () => generateId<BotId>(),
            botId: () => scenario.systemBotId,
            spaceId: () => scenario.space.id,
            expected: false,
        },
        {
            name: "returns false when the target bot does not exist",
            operation: () => ({type: "View"}),
            actorBotId: () => scenario.accountBotId,
            botId: () => generateId<BotId>(),
            spaceId: () => scenario.space.id,
            expected: false,
        },
    ];

    for (const {name, operation, actorBotId, botId, spaceId, expected} of testCases) {
        test(`${name}`, async () => {
            const hasAccess = await hasBotOperationAccessForBot(
                scenario.space.systemAction(),
                operation(),
                {
                    spaceId: spaceId(),
                    actorBotId: actorBotId(),
                    botId: botId(),
                    consistency: "Strong",
                },
            );

            expect(hasAccess).toBe(expected);
        });
    }
});

describe("getAllowedBotOperations()", () => {
    type AllowedOperationsTestCase = {
        readonly name: string;
        readonly action: () => ServerActionContext;
        readonly botId: () => BotId;
        // The account the `*ForActor` operations are resolved against, which is not
        // necessarily the actor's own account.
        readonly accountId: () => AccountId;
        readonly expected: ReadonlyArray<BotOperationType>;
    };

    const testCases: ReadonlyArray<AllowedOperationsTestCase> = [
        {
            name: "returns every operation for the owner of an account-owned bot",
            action: () => scenario.ownerSession.action(),
            botId: () => scenario.accountBotId,
            accountId: () => scenario.ownerSession.account.id,
            expected: [
                "View",
                "Manage",
                "Install",
                "ViewSpaceSettings",
                "ManageSpaceSettings",
                "ViewSpaceSettingsForActor",
                "ManageSpaceSettingsForActor",
                "Message",
            ],
        },
        {
            name: "returns no operations for another account\u2019s bot",
            action: () => scenario.memberSession.action(),
            botId: () => scenario.accountBotId,
            accountId: () => scenario.memberSession.account.id,
            expected: [],
        },
        {
            name: "returns only read operations for a member of a space-owned bot\u2019s space",
            action: () => scenario.memberSession.action(),
            botId: () => scenario.spaceBotId,
            accountId: () => scenario.memberSession.account.id,
            expected: [
                "View",
                "ViewSpaceSettings",
                "ViewSpaceSettingsForActor",
                "ManageSpaceSettingsForActor",
                "Message",
            ],
        },
        {
            name: "returns every operation for an admin of a space-owned bot\u2019s space",
            action: () => scenario.adminSession.action(),
            botId: () => scenario.spaceBotId,
            accountId: () => scenario.adminSession.account.id,
            expected: [
                "View",
                "Manage",
                "Install",
                "ViewSpaceSettings",
                "ManageSpaceSettings",
                "ViewSpaceSettingsForActor",
                "ManageSpaceSettingsForActor",
                "Message",
            ],
        },
        {
            name: "returns no operations for a non-member of a space-owned bot\u2019s space",
            action: () => scenario.outsiderSession.action(),
            botId: () => scenario.spaceBotId,
            accountId: () => scenario.outsiderSession.account.id,
            expected: [],
        },
        {
            name: "excludes managing a system bot for an account without internal access",
            action: () => scenario.memberSession.action(),
            botId: () => scenario.systemBotId,
            accountId: () => scenario.memberSession.account.id,
            expected: [
                "View",
                "ViewSpaceSettings",
                "ViewSpaceSettingsForActor",
                "ManageSpaceSettingsForActor",
                "Message",
            ],
        },
        {
            name: "includes managing a system bot for an internal account",
            action: () => scenario.internalSession.action(),
            botId: () => scenario.systemBotId,
            accountId: () => scenario.internalSession.account.id,
            expected: [
                "View",
                "Manage",
                "ViewSpaceSettings",
                "ViewSpaceSettingsForActor",
                "ManageSpaceSettingsForActor",
                "Message",
            ],
        },
        {
            name: "includes installing a system bot for a space admin without internal access",
            action: () => scenario.adminSession.action(),
            botId: () => scenario.systemBotId,
            accountId: () => scenario.adminSession.account.id,
            expected: [
                "View",
                "Install",
                "ViewSpaceSettings",
                "ManageSpaceSettings",
                "ViewSpaceSettingsForActor",
                "ManageSpaceSettingsForActor",
                "Message",
            ],
        },
        {
            name: "returns only read operations for a bot actor acting on a bot with the same owner",
            action: () => scenario.accountBotAction(),
            botId: () => scenario.ownerSecondAccountBotId,
            accountId: () => scenario.memberSession.account.id,
            expected: ["View", "ViewSpaceSettings", "Message"],
        },
        {
            name: "includes viewing another account\u2019s settings for a bot actor acting on itself",
            action: () => scenario.accountBotAction(),
            botId: () => scenario.accountBotId,
            accountId: () => scenario.memberSession.account.id,
            expected: ["View", "ViewSpaceSettings", "ViewSpaceSettingsForActor", "Message"],
        },
        {
            name: "returns no operations when the bot does not exist",
            action: () => scenario.ownerSession.action(),
            botId: () => generateId<BotId>(),
            accountId: () => scenario.ownerSession.account.id,
            expected: [],
        },
    ];

    for (const {name, action, botId, accountId, expected} of testCases) {
        test(`${name}`, async () => {
            const allowedOperations = await getAllowedBotOperations(action(), botId(), {
                spaceId: scenario.space.id,
                accountId: accountId(),
            });

            expect([...allowedOperations].sort()).toEqual([...expected].sort());
        });
    }

    test("defaults the account to the actor\u2019s own account", async () => {
        const withDefaultAccount = await getAllowedBotOperations(
            scenario.memberSession.action(),
            scenario.spaceBotId,
            {spaceId: scenario.space.id},
        );

        const withExplicitAccount = await getAllowedBotOperations(
            scenario.memberSession.action(),
            scenario.spaceBotId,
            {spaceId: scenario.space.id, accountId: scenario.memberSession.account.id},
        );

        expect([...withDefaultAccount].sort()).toEqual([...withExplicitAccount].sort());
    });

    test("resolves only the space-independent operations without a space", async () => {
        const allowedOperations = await getAllowedBotOperations(
            scenario.ownerSession.action(),
            scenario.accountBotId,
        );

        expect([...allowedOperations].sort()).toEqual(["Manage", "View"]);
    });

    test("resolves a space-owned bot against its owning space without a space", async () => {
        const allowedOperations = await getAllowedBotOperations(
            scenario.memberSession.action(),
            scenario.spaceBotId,
        );

        // A member of the owning space may view it but not manage it.
        expect([...allowedOperations].sort()).toEqual(["View"]);
    });

    test("returns no operations without a space when the actor may not view the bot", async () => {
        const allowedOperations = await getAllowedBotOperations(
            scenario.memberSession.action(),
            scenario.accountBotId,
        );

        expect([...allowedOperations]).toEqual([]);
    });

    test("omits the per-actor operations for an actor without an account", async () => {
        const allowedOperations = await getAllowedBotOperations(
            scenario.space.systemAction(),
            scenario.systemBotId,
            {spaceId: scenario.space.id},
        );

        expect(allowedOperations.has("ViewSpaceSettingsForActor")).toBe(false);
        expect(allowedOperations.has("ManageSpaceSettingsForActor")).toBe(false);
    });

    // `BotOperationSpaceRoleCache` caches space roles for the lifetime of the action,
    // and those roles depend entirely on who the actor is. If it were ever declared
    // `DangerouslyShare` instead of `SafelyReset` the admin's roles would survive the
    // fork and the member would inherit the admin's operations.
    test("does not leak resolved space roles when the actor changes", async () => {
        const adminAction = scenario.adminSession.action();

        const adminOperations = await getAllowedBotOperations(adminAction, scenario.spaceBotId, {
            spaceId: scenario.space.id,
            accountId: scenario.adminSession.account.id,
        });
        expect(adminOperations.has("Manage")).toBe(true);

        // Mirrors how `impersonateAccountAsSystemContext()` swaps the actor within a
        // single action while carrying the cache forward.
        const memberAction = scenario.memberSession
            .action()
            .clone({cache: adminAction.cache.forkForChangedActor()});

        const memberOperations = await getAllowedBotOperations(memberAction, scenario.spaceBotId, {
            spaceId: scenario.space.id,
            accountId: scenario.memberSession.account.id,
        });

        expect([...memberOperations].sort()).toEqual(
            [
                "View",
                "ViewSpaceSettings",
                "ViewSpaceSettingsForActor",
                "ManageSpaceSettingsForActor",
                "Message",
            ].sort(),
        );
    });

    // `getAllowedBotOperations()` resolves the whole set at once while
    // `hasBotOperationAccess()` resolves one operation at a time. They share the same
    // permission logic, so any disagreement means the two paths have drifted apart.
    for (const {name, action, botId, accountId} of testCases) {
        test(`${name} (agrees with hasBotOperationAccess())`, async () => {
            const spaceId = scenario.space.id;

            const operations: ReadonlyArray<BotOperation> = [
                {type: "View"},
                {type: "Manage"},
                {type: "Install", spaceId},
                {type: "ViewSpaceSettings", spaceId},
                {type: "ManageSpaceSettings", spaceId},
                {type: "ViewSpaceSettingsForActor", spaceId, accountId: accountId()},
                {type: "ManageSpaceSettingsForActor", spaceId, accountId: accountId()},
                {type: "Message", spaceId},
            ];

            const [allowedOperations, hasAccessByIndex] = await runAllPromises([
                getAllowedBotOperations(action(), botId(), {spaceId, accountId: accountId()}),
                runAllPromises(
                    operations.map(operation =>
                        hasBotOperationAccess(action(), botId(), operation),
                    ),
                ),
            ]);

            const expected = operations
                .filter((_, index) => hasAccessByIndex[index])
                .map(({type}) => type);

            expect([...allowedOperations].sort()).toEqual(expected.sort());
        });
    }
});

describe("authorizeBotOperation()", () => {
    test("resolves when the actor may perform the operation", async () => {
        await expect(
            authorizeBotOperation(
                scenario.ownerSession.action(),
                scenario.accountBotId,
                {type: "View"},
                {consistency: "Strong"},
            ),
        ).resolves.toBeUndefined();
    });

    test("throws the access error when the actor may not perform a non-install operation", async () => {
        await expect(
            authorizeBotOperation(scenario.memberSession.action(), scenario.accountBotId, {
                type: "Manage",
            }),
        ).rejects.toThrow("Account may not manage this bot");
    });

    test("throws the install error when the actor may not install the bot", async () => {
        await expect(
            authorizeBotOperation(scenario.memberSession.action(), scenario.spaceBotId, {
                type: "Install",
                spaceId: scenario.space.id,
            }),
        ).rejects.toThrow("Account may not install this bot in this space");
    });

    test("throws the not-found error when the bot does not exist", async () => {
        await expect(
            authorizeBotOperation(scenario.ownerSession.action(), generateId<BotId>(), {
                type: "View",
            }),
        ).rejects.toThrow("Bot not found");
    });
});

describe("authorizeBotCreation()", () => {
    test("allows an account to create a bot it owns", async () => {
        await expect(
            authorizeBotCreation(scenario.ownerSession.action(), {
                ownerEntity: {type: "Account", accountId: scenario.ownerSession.account.id},
            }),
        ).resolves.toBeUndefined();
    });

    test("allows an account to create and install its bot in a space where it is a member", async () => {
        await expect(
            authorizeBotCreation(scenario.ownerSession.action(), {
                ownerEntity: {type: "Account", accountId: scenario.ownerSession.account.id},
                installSpaceId: scenario.space.id,
            }),
        ).resolves.toBeUndefined();
    });

    test("prevents an account from creating a bot owned by another account", async () => {
        await expect(
            authorizeBotCreation(scenario.memberSession.action(), {
                ownerEntity: {type: "Account", accountId: scenario.ownerSession.account.id},
            }),
        ).rejects.toThrow("Account cannot create a bot with the given owner entity");
    });

    test("prevents an owner from installing its new bot in a space where it is not a member", async () => {
        await expect(
            authorizeBotCreation(scenario.ownerSession.action(), {
                ownerEntity: {type: "Account", accountId: scenario.ownerSession.account.id},
                installSpaceId: scenario.otherSpace.id,
            }),
        ).rejects.toThrow("Account may not install this bot in this space");
    });

    test("allows an admin to create and install a bot owned by their space", async () => {
        await expect(
            authorizeBotCreation(scenario.adminSession.action(), {
                ownerEntity: {type: "Space", spaceId: scenario.space.id},
                installSpaceId: scenario.space.id,
            }),
        ).resolves.toBeUndefined();
    });

    test("prevents a member from creating a bot owned by their space", async () => {
        await expect(
            authorizeBotCreation(scenario.memberSession.action(), {
                ownerEntity: {type: "Space", spaceId: scenario.space.id},
            }),
        ).rejects.toThrow("Account cannot create a bot with the given owner entity");
    });

    test("prevents an admin from installing a new space bot outside its owning space", async () => {
        await expect(
            authorizeBotCreation(scenario.adminSession.action(), {
                ownerEntity: {type: "Space", spaceId: scenario.space.id},
                installSpaceId: scenario.otherSpace.id,
            }),
        ).rejects.toThrow("Account may not install this bot in this space");
    });

    test("allows an internal account to create a system-owned bot without installing it", async () => {
        await expect(
            authorizeBotCreation(scenario.internalSession.action(), {
                ownerEntity: {type: "System"},
            }),
        ).resolves.toBeUndefined();
    });

    test("prevents an account without internal access from creating a system-owned bot", async () => {
        await expect(
            authorizeBotCreation(scenario.memberSession.action(), {
                ownerEntity: {type: "System"},
            }),
        ).rejects.toThrow("Account cannot create a bot with the given owner entity");
    });

    test("prevents an internal member from installing a new system bot without admin access", async () => {
        await expect(
            authorizeBotCreation(scenario.internalSession.action(), {
                ownerEntity: {type: "System"},
                installSpaceId: scenario.space.id,
            }),
        ).rejects.toThrow("Account may not install this bot in this space");
    });
});
