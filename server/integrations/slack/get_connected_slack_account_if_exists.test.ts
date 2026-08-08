import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSlackAccountIntegration} from "~/server/integrations/slack/create_slack_account_integration.js";
import {createSlackWorkspaceIntegration} from "~/server/integrations/slack/create_slack_workspace_integration.js";
import {getConnectedSlackAccountIfExists} from "~/server/integrations/slack/get_connected_slack_account_if_exists.js";
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

async function connectAccount(session: TestSpaceSession) {
    await createSlackAccountIntegration(session.action(), {
        spaceId: session.space.id,
        slackUserId: "U12345",
        workspaceId,
        displayName: "Test User",
        profileImageUrl: "https://slack.com/avatar.png",
    });
}

test("returns null when no Slack account is connected", async () => {
    const space = await TestSpace.create(context);
    const [adminSession, memberSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession({role: "Member"}),
    ]);
    await connectWorkspace(adminSession);

    const result = await getConnectedSlackAccountIfExists(memberSession.action(), {
        spaceId: space.id,
        workspaceId,
        accountId: memberSession.account.id,
    });

    expect(result).toBeNull();
});

test("returns connected Slack account details when account is linked", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);
    await connectAccount(adminSession);

    const result = await getConnectedSlackAccountIfExists(adminSession.action(), {
        spaceId: space.id,
        workspaceId,
        accountId: adminSession.account.id,
    });

    expect(result).toMatchObject({slackUserId: "U12345", displayName: "Test User"});
});

test("returns connected account when workspaceId is omitted and workspace is connected", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);
    await connectAccount(adminSession);

    const result = await getConnectedSlackAccountIfExists(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
    });

    expect(result?.slackUserId).toBe("U12345");
});

test("returns null when workspaceId is omitted and no workspace is connected", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const result = await getConnectedSlackAccountIfExists(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
    });

    expect(result).toBeNull();
});

test("throws PermissionDeniedError when accessing another account\u2019s integration", async () => {
    const space = await TestSpace.create(context);
    const [adminSession, memberSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession({role: "Member"}),
    ]);

    await expect(
        getConnectedSlackAccountIfExists(memberSession.action(), {
            spaceId: space.id,
            workspaceId,
            accountId: adminSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});
