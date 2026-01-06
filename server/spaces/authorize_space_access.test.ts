import {TestBot, TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    authorizeSpaceAccess,
    authorizeSpaceAccessIfPossible,
} from "~/server/spaces/authorize_space_access.js";
import {removeSpaceAccount} from "~/server/spaces/remove_space_account.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {updateSpaceAccountRole} from "~/server/spaces/update_space_account_role.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {SpaceAccountStateType} from "~/shared/spaces/space_account_state.js";
import {SpaceRole} from "~/shared/spaces/space_model.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection: {internalGetUpdateOurAccountNameTaskTransactionEntries: () => []},
});

const setupUserState = async ({
    space,
    userRole,
    spaceAccountStateType,
}: {
    space: TestSpace;
    userRole: SpaceRole;
    spaceAccountStateType: SpaceAccountStateType;
}) => {
    if (userRole === "Owner") {
        assert(spaceAccountStateType === "Active", "Owners must be active in the space");
        return space.createSession({role: "Owner"});
    }

    const ownerSession = await space.createSession({role: "Owner"});
    const userAccount = await TestAccount.create(context);
    const userEmail = await userAccount.createEmailAddress();

    const invite = await space.inviteEmailAddressAndCreateSession(ownerSession.action(), userEmail);

    if (spaceAccountStateType === "Removed") {
        await removeSpaceAccount(ownerSession.action(), {
            spaceId: space.id,
            accountId: userAccount.id,
        });
    } else if (spaceAccountStateType === "Active") {
        await invite.acceptInvite();

        if (userRole === "Admin") {
            await updateSpaceAccountRole(ownerSession.action(), {
                spaceId: space.id,
                accountId: userAccount.id,
                role: "Admin",
            });
        }
    }

    return invite.session;
};

const allowedTestCases: Array<{
    userRole: SpaceRole;
    expectedRole: SpaceRole;
    userSpaceAccountStateType: SpaceAccountStateType;
    allowInvitePending: boolean;
}> = [
    {
        userRole: "Member",
        expectedRole: "Member",
        userSpaceAccountStateType: "Active",
        allowInvitePending: false,
    },
    {
        userRole: "Admin",
        expectedRole: "Member",
        userSpaceAccountStateType: "Active",
        allowInvitePending: false,
    },
    {
        userRole: "Owner",
        expectedRole: "Member",
        userSpaceAccountStateType: "Active",
        allowInvitePending: false,
    },
    {
        userRole: "Admin",
        expectedRole: "Admin",
        userSpaceAccountStateType: "Active",
        allowInvitePending: false,
    },
    {
        userRole: "Owner",
        expectedRole: "Admin",
        userSpaceAccountStateType: "Active",
        allowInvitePending: false,
    },
    {
        userRole: "Owner",
        expectedRole: "Owner",
        userSpaceAccountStateType: "Active",
        allowInvitePending: false,
    },
    {
        userRole: "Member",
        expectedRole: "Member",
        userSpaceAccountStateType: "Active",
        allowInvitePending: false,
    },
    {
        userRole: "Member",
        expectedRole: "Member",
        userSpaceAccountStateType: "InvitePending",
        allowInvitePending: true,
    },
];

for (const {
    userRole,
    expectedRole,
    userSpaceAccountStateType,
    allowInvitePending,
} of allowedTestCases) {
    test(`allows: role ${userRole}, ${userSpaceAccountStateType} state, allowed ${expectedRole} and allow invite pending ${allowInvitePending}`, async () => {
        const space = await TestSpace.create(context);

        const userSession = await setupUserState({
            space,
            userRole,
            spaceAccountStateType: userSpaceAccountStateType,
        });

        await authorizeSpaceAccess(userSession.action(), space.id, expectedRole, {
            allowInvitePending,
        });
    });
}

const disallowedTestCases: Array<{
    userRole: SpaceRole;
    expectedRole: SpaceRole;
    userSpaceAccountStateType: SpaceAccountStateType;
    allowInvitePending: boolean;
}> = [
    {
        userRole: "Member",
        expectedRole: "Admin",
        userSpaceAccountStateType: "Active",
        allowInvitePending: false,
    },
    {
        userRole: "Member",
        expectedRole: "Admin",
        userSpaceAccountStateType: "Active",
        allowInvitePending: false,
    },
    {
        userRole: "Member",
        expectedRole: "Owner",
        userSpaceAccountStateType: "Active",
        allowInvitePending: false,
    },
    {
        userRole: "Admin",
        expectedRole: "Owner",
        userSpaceAccountStateType: "Active",
        allowInvitePending: false,
    },
    {
        userRole: "Member",
        expectedRole: "Member",
        userSpaceAccountStateType: "Removed",
        allowInvitePending: false,
    },
    {
        userRole: "Member",
        expectedRole: "Member",
        userSpaceAccountStateType: "Removed",
        allowInvitePending: true,
    },
    {
        userRole: "Member",
        expectedRole: "Member",
        userSpaceAccountStateType: "InvitePending",
        allowInvitePending: false,
    },
];

for (const {
    userRole,
    expectedRole,
    userSpaceAccountStateType,
    allowInvitePending,
} of disallowedTestCases) {
    test(`disallows: role ${userRole}, ${userSpaceAccountStateType} state, allowed ${expectedRole} and allow invite pending ${allowInvitePending}`, async () => {
        const space = await TestSpace.create(context);

        const userSession = await setupUserState({
            space,
            userRole,
            spaceAccountStateType: userSpaceAccountStateType,
        });

        await expect(
            authorizeSpaceAccess(userSession.action(), space.id, expectedRole, {
                allowInvitePending,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });
}

describe("bot actor", () => {
    type Options = {
        sharedBot: TestBot;
        space: TestSpace;
        otherSpace: TestSpace;
        session: TestSpaceSession;
        otherSession: TestSpaceSession;
    };

    const botAccount = {
        name: "bot",
        make: (options: Options) => TestBot.createAndInstantiate(options.session),
    };

    const otherBotAccount = {
        name: "other bot",
        make: (options: Options) => TestBot.createAndInstantiate(options.otherSession),
    };

    const sharedBotAccount = {
        name: "shared bot",
        make: (options: Options) => options.sharedBot.instantiate(options.session),
    };

    const otherSharedBotAccount = {
        name: "other shared bot",
        make: (options: Options) => options.sharedBot.instantiate(options.otherSession),
    };

    const space = {
        name: "space",
        make: (options: Options) => options.space,
    };

    const otherSpace = {
        name: "other space",
        make: (options: Options) => options.otherSpace,
    };

    const testCases: Array<{
        ok: boolean;
        botAccount: {name: string; make: (options: Options) => MaybePromise<TestBotAccount>};
        space: {name: string; make: (options: Options) => MaybePromise<TestSpace>};
    }> = [
        {ok: true, botAccount, space},
        {ok: false, botAccount, space: otherSpace},
        {ok: false, botAccount: otherBotAccount, space},
        {ok: true, botAccount: otherBotAccount, space: otherSpace},
        {ok: true, botAccount: sharedBotAccount, space},
        {ok: false, botAccount: sharedBotAccount, space: otherSpace},
        {ok: false, botAccount: otherSharedBotAccount, space},
        {ok: true, botAccount: otherSharedBotAccount, space: otherSpace},
    ];

    for (const testCase of testCases) {
        test(`\`authorizeSpaceAccess()\` for ${testCase.botAccount.name} ${
            testCase.ok ? "succeeds" : "fails"
        } in ${testCase.space.name}`, async () => {
            const [sharedBot, space, otherSpace] = await runAllPromises([
                TestBot.create(context),
                TestSpace.create(context),
                TestSpace.create(context),
            ]);

            const [session, otherSession] = await runAllPromises([
                space.createSession({role: "Admin"}),
                otherSpace.createSession({role: "Admin"}),
            ]);

            const options = {
                sharedBot,
                space,
                otherSpace,
                session,
                otherSession,
            };

            const [testBotAccount, testSpace] = await runAllPromises([
                testCase.botAccount.make(options),
                testCase.space.make(options),
            ]);

            if (testCase.ok) {
                await authorizeSpaceAccess(testBotAccount.action(), testSpace.id);
            } else {
                await expect(
                    authorizeSpaceAccess(testBotAccount.action(), testSpace.id),
                ).rejects.toThrow(PermissionDeniedError);
            }
        });

        test(`\`authorizeSpaceAccessIfPossible()\` for ${testCase.botAccount.name} ${
            testCase.ok ? "succeeds" : "fails"
        } in ${testCase.space.name}`, async () => {
            const [sharedBot, space, otherSpace] = await runAllPromises([
                TestBot.create(context),
                TestSpace.create(context),
                TestSpace.create(context),
            ]);

            const [session, otherSession] = await runAllPromises([
                space.createSession({role: "Admin"}),
                otherSpace.createSession({role: "Admin"}),
            ]);

            const options = {
                sharedBot,
                space,
                otherSpace,
                session,
                otherSession,
            };

            const [testBotAccount, testSpace] = await runAllPromises([
                testCase.botAccount.make(options),
                testCase.space.make(options),
            ]);

            if (testCase.ok) {
                expect(
                    (await authorizeSpaceAccessIfPossible(testBotAccount.action(), testSpace.id))
                        .ok,
                ).toEqual(true);
            } else {
                expect(
                    (await authorizeSpaceAccessIfPossible(testBotAccount.action(), testSpace.id))
                        .ok,
                ).toEqual(false);
            }
        });
    }
});
