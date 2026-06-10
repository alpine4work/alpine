import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSlackWorkspaceIntegration} from "~/server/integrations/slack/create_slack_workspace_integration.js";
import {getConnectedSlackWorkspaceIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_if_exists.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {PermissionDeniedError} from "~/shared/error/error.js";

const context = createTestContext();

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

test("returns null when no Slack workspace is connected to the space", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const result = await getConnectedSlackWorkspaceIfExists(adminSession.action(), {
        spaceId: space.id,
    });

    expect(result).toBeNull();
});

test("returns the connected workspace details", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    const result = await getConnectedSlackWorkspaceIfExists(adminSession.action(), {
        spaceId: space.id,
    });

    expect(result).toMatchObject({
        workspaceId,
        workspaceName: "Test Workspace",
        workspaceImageUrl: "https://slack.com/icon.png",
    });
});

test("returns workspace when queried by matching workspaceId", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    const result = await getConnectedSlackWorkspaceIfExists(adminSession.action(), {
        spaceId: space.id,
        workspaceId,
    });

    expect(result?.workspaceId).toBe(workspaceId);
});

test("returns null when queried for a non-existent workspaceId", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    const result = await getConnectedSlackWorkspaceIfExists(adminSession.action(), {
        spaceId: space.id,
        workspaceId: "W-does-not-exist",
    });

    expect(result).toBeNull();
});

test("throws PermissionDeniedError when actor does not have space access", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const outsiderSession = await otherSpace.createSession({role: "Member"});

    await expect(
        getConnectedSlackWorkspaceIfExists(outsiderSession.action(), {spaceId: space.id}),
    ).rejects.toThrow(PermissionDeniedError);
});
