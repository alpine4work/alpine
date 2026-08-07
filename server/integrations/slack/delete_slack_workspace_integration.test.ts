import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSlackAccountIntegration} from "~/server/integrations/slack/create_slack_account_integration.js";
import {createSlackWorkspaceIntegration} from "~/server/integrations/slack/create_slack_workspace_integration.js";
import {deleteSlackWorkspaceIntegration} from "~/server/integrations/slack/delete_slack_workspace_integration.js";
import {getConnectedSlackAccountIfExists} from "~/server/integrations/slack/get_connected_slack_account_if_exists.js";
import {getConnectedSlackWorkspaceIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_if_exists.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.open_source.js";

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

test("workspace integration is no longer readable after deletion", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    await deleteSlackWorkspaceIntegration(adminSession.action(), {
        spaceId: space.id,
        workspaceId,
    });

    const workspace = await getConnectedSlackWorkspaceIfExists(
        adminSession.action(),
        {
            spaceId: space.id,
        },
        {consistency: "Strong"},
    );

    expect(workspace).toBeNull();
});

test("deletes all linked Slack account integrations when workspace is removed", async () => {
    const space = await TestSpace.create(context);
    const [adminSession, memberSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession({role: "Member"}),
    ]);
    await connectWorkspace(adminSession);

    // Connect both accounts to the workspace.
    await runAllPromises([
        createSlackAccountIntegration(adminSession.action(), {
            spaceId: space.id,
            slackUserId: "U111",
            workspaceId,
            displayName: "Admin User",
            profileImageUrl: "https://slack.com/avatar1.png",
        }),
        createSlackAccountIntegration(memberSession.action(), {
            spaceId: space.id,
            slackUserId: "U222",
            workspaceId,
            displayName: "Member User",
            profileImageUrl: "https://slack.com/avatar2.png",
        }),
    ]);

    await deleteSlackWorkspaceIntegration(adminSession.action(), {
        spaceId: space.id,
        workspaceId,
    });

    const [adminAccount, memberAccount] = await runAllPromises([
        getConnectedSlackAccountIfExists(
            adminSession.action(),
            {
                spaceId: space.id,
                workspaceId,
                accountId: adminSession.account.id,
            },
            {consistency: "Strong"},
        ),
        getConnectedSlackAccountIfExists(
            memberSession.action(),
            {
                spaceId: space.id,
                workspaceId,
                accountId: memberSession.account.id,
            },
            {consistency: "Strong"},
        ),
    ]);

    expect(adminAccount).toBeNull();
    expect(memberAccount).toBeNull();
});

test("throws PermissionDeniedError when actor does not have admin access", async () => {
    const space = await TestSpace.create(context);
    const [adminSession, memberSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession({role: "Member"}),
    ]);
    await connectWorkspace(adminSession);

    await expect(
        deleteSlackWorkspaceIntegration(memberSession.action(), {
            spaceId: space.id,
            workspaceId,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});
