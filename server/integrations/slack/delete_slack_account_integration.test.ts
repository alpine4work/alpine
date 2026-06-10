import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSlackAccountIntegration} from "~/server/integrations/slack/create_slack_account_integration.js";
import {createSlackWorkspaceIntegration} from "~/server/integrations/slack/create_slack_workspace_integration.js";
import {deleteSlackAccountIntegration} from "~/server/integrations/slack/delete_slack_account_integration.js";
import {getConnectedSlackAccountIfExists} from "~/server/integrations/slack/get_connected_slack_account_if_exists.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfSlackIntegrationChange: asyncNoop,
    },
});

const workspaceId = "W12345";

async function connectWorkspace(adminSession: TestSpaceSession) {
    await createSlackWorkspaceIntegration(adminSession.action(), {
        spaceId: adminSession.space.id,
        workspaceId,
        workspaceName: "Test Workspace",
        workspaceImageUrl: "https://slack.com/icon.png",
        botToken: "xoxb-test",
        botUserId: "B12345",
        botScopes: new Set(),
    });
}

async function connectAccount(session: TestSpaceSession) {
    await createSlackAccountIntegration(session.action(), {
        spaceId: session.space.id,
        slackUserId: "U12345",
        workspaceId,
        displayName: "Test User",
        profileImageUrl: "https://slack.com/avatar.png",
    });
}

test("session actor can delete their own Slack account integration", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);
    await connectAccount(adminSession);

    await deleteSlackAccountIntegration(adminSession.action(), {
        accountId: adminSession.account.id,
        spaceId: space.id,
        workspaceId,
    });

    const account = await getConnectedSlackAccountIfExists(adminSession.action(), {
        spaceId: space.id,
        workspaceId,
        accountId: adminSession.account.id,
    });

    expect(account).toBeNull();
});

test("session actor throws PermissionDeniedError when deleting another account", async () => {
    const space = await TestSpace.create(context);
    const [adminSession, memberSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession({role: "Member"}),
    ]);
    await connectWorkspace(adminSession);
    await connectAccount(adminSession);

    await expect(
        deleteSlackAccountIntegration(memberSession.action(), {
            accountId: adminSession.account.id,
            spaceId: space.id,
            workspaceId,
        }),
    ).rejects.toThrow("Can\u2019t disconnect Slack account for a different account");
});

test("system actor can delete a Slack account integration for any account", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);
    await connectAccount(adminSession);

    await deleteSlackAccountIntegration(space.systemAction(), {
        accountId: adminSession.account.id,
        spaceId: space.id,
        workspaceId,
    });

    const account = await getConnectedSlackAccountIfExists(adminSession.action(), {
        spaceId: space.id,
        workspaceId,
        accountId: adminSession.account.id,
    });

    expect(account).toBeNull();
});

test("anonymous actor throws UnauthenticatedError", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await expect(
        deleteSlackAccountIntegration(context.anonymousAction(), {
            accountId: adminSession.account.id,
            spaceId: space.id,
            workspaceId,
        }),
    ).rejects.toThrow("Unauthenticated session");
});

test("bot actor throws PermissionDeniedError", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const botAccount = await TestBot.createAndInstantiate(adminSession);

    await expect(
        deleteSlackAccountIntegration(botAccount.action(), {
            accountId: adminSession.account.id,
            spaceId: space.id,
            workspaceId,
        }),
    ).rejects.toThrow("Bot account not allowed");
});
