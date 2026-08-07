import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSlackAccountIntegration} from "~/server/integrations/slack/create_slack_account_integration.js";
import {createSlackWorkspaceIntegration} from "~/server/integrations/slack/create_slack_workspace_integration.js";
import {getConnectedSlackAccountIfExists} from "~/server/integrations/slack/get_connected_slack_account_if_exists.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
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

test("returns Slack account details after creating account integration", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    const result = await createSlackAccountIntegration(adminSession.action(), {
        spaceId: space.id,
        slackUserId: "U12345",
        workspaceId,
        displayName: "Test User",
        realName: "Test User Real",
        email: "test@example.com",
        profileImageUrl: "https://slack.com/avatar.png",
    });

    expect(result).toMatchObject({
        slackUserId: "U12345",
        displayName: "Test User",
    });
});

test("account integration is readable after creation", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    await createSlackAccountIntegration(adminSession.action(), {
        spaceId: space.id,
        slackUserId: "U12345",
        workspaceId,
        displayName: "Test User",
        profileImageUrl: "https://slack.com/avatar.png",
    });

    const account = await getConnectedSlackAccountIfExists(adminSession.action(), {
        spaceId: space.id,
        workspaceId,
        accountId: adminSession.account.id,
    });

    expect(account).toMatchObject({slackUserId: "U12345"});
});

test("is idempotent when account is already connected", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    await createSlackAccountIntegration(adminSession.action(), {
        spaceId: space.id,
        slackUserId: "U12345",
        workspaceId,
        displayName: "Original Name",
        profileImageUrl: "https://slack.com/avatar.png",
    });

    // Second call should not overwrite the existing record.
    await createSlackAccountIntegration(adminSession.action(), {
        spaceId: space.id,
        slackUserId: "U99999",
        workspaceId,
        displayName: "Updated Name",
        profileImageUrl: "https://slack.com/avatar2.png",
    });

    const account = await getConnectedSlackAccountIfExists(adminSession.action(), {
        spaceId: space.id,
        workspaceId,
        accountId: adminSession.account.id,
    });

    expect(account?.slackUserId).toBe("U12345");
});

test("throws FailedPreconditionError when no Slack workspace is connected to the space", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await expect(
        createSlackAccountIntegration(adminSession.action(), {
            spaceId: space.id,
            slackUserId: "U12345",
            workspaceId,
            displayName: "Test User",
            profileImageUrl: "https://slack.com/avatar.png",
        }),
    ).rejects.toThrow("No connected Slack workspace found for the space");
});

test("throws PermissionDeniedError when actor does not have space access", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    const outsiderSession = await otherSpace.createSession({role: "Member"});

    await expect(
        createSlackAccountIntegration(outsiderSession.action(), {
            spaceId: space.id,
            slackUserId: "U12345",
            workspaceId,
            displayName: "Test User",
            profileImageUrl: "https://slack.com/avatar.png",
        }),
    ).rejects.toThrow(PermissionDeniedError);
});
