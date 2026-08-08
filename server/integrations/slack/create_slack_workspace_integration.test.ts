import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSlackWorkspaceIntegration} from "~/server/integrations/slack/create_slack_workspace_integration.js";
import {getConnectedSlackWorkspaceIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_if_exists.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";

const context = createTestContext();

const testWorkspaceArgs = {
    workspaceId: "W12345",
    workspaceName: "Test Workspace",
    workspaceImageUrl: "https://slack.com/workspace-icon.png",
    botToken: "xoxb-test-bot-token",
    botUserId: "B12345",
    botScopes: new Set(["chat:write", "users:read"]),
};

test("returns workspace details after creating Slack workspace integration", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const result = await createSlackWorkspaceIntegration(adminSession.action(), {
        spaceId: space.id,
        ...testWorkspaceArgs,
    });

    expect(result).toMatchObject({
        workspaceId: "W12345",
        workspaceName: "Test Workspace",
        workspaceImageUrl: "https://slack.com/workspace-icon.png",
    });
});

test("sets connectedByAccountId to the creating actor", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const result = await createSlackWorkspaceIntegration(adminSession.action(), {
        spaceId: space.id,
        ...testWorkspaceArgs,
    });

    expect(result.connectedByAccountId).toBe(adminSession.account.id);
});

test("workspace integration is readable after creation", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await createSlackWorkspaceIntegration(adminSession.action(), {
        spaceId: space.id,
        ...testWorkspaceArgs,
    });

    const workspace = await getConnectedSlackWorkspaceIfExists(adminSession.action(), {
        spaceId: space.id,
    });

    expect(workspace).toMatchObject({
        workspaceId: "W12345",
        workspaceName: "Test Workspace",
    });
});

test("throws PermissionDeniedError when actor does not have admin access", async () => {
    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    await expect(
        createSlackWorkspaceIntegration(memberSession.action(), {
            spaceId: space.id,
            ...testWorkspaceArgs,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("throws when a workspace is already connected to the space", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await createSlackWorkspaceIntegration(adminSession.action(), {
        spaceId: space.id,
        ...testWorkspaceArgs,
    });

    await expect(
        createSlackWorkspaceIntegration(adminSession.action(), {
            spaceId: space.id,
            ...testWorkspaceArgs,
        }),
    ).rejects.toThrow();
});
