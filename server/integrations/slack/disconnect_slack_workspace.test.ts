import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSlackWorkspaceIntegration} from "~/server/integrations/slack/create_slack_workspace_integration.js";
import {disconnectSlackWorkspace} from "~/server/integrations/slack/disconnect_slack_workspace.js";
import {getConnectedSlackWorkspaceIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_if_exists.js";
import {NoopSlackContextModule} from "~/server/integrations/slack/noop_slack_context_module.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {ErrorBase, PermissionDeniedError, UnknownError} from "~/shared/error/error.open_source.js";
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

/**
 * A configurable slack module for simulating various Slack API uninstall
 * responses. Simulates the outcomes that
 * `SlackContextModule.uninstallAlpineAppFromSlackWorkspace` would produce for
 * different Slack API error codes.
 */
class ConfigurableUninstallSlackContextModule extends NoopSlackContextModule {
    private readonly _uninstallResult: {ok: boolean; error?: ErrorBase};

    constructor(uninstallResult: {ok: boolean; error?: ErrorBase}) {
        super();
        this._uninstallResult = uninstallResult;
    }

    public override async uninstallAlpineAppFromSlackWorkspace() {
        return this._uninstallResult;
    }

    public override fork(): SlackContextModuleBase {
        return new ConfigurableUninstallSlackContextModule(this._uninstallResult);
    }
}

/**
 * Creates an action context using a custom slack module so we can simulate
 * different Slack API responses from `uninstallAlpineAppFromSlackWorkspace`.
 */
function actionWithSlack(
    session: TestSpaceSession,
    slack: SlackContextModuleBase,
): ServerSessionActionContext & {slack: SlackContextModuleBase} {
    return session.action().clone({slack});
}

test("removes workspace from database after successful disconnect", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    await disconnectSlackWorkspace(adminSession.action(), {spaceId: space.id, workspaceId});

    const workspace = await getConnectedSlackWorkspaceIfExists(
        adminSession.action(),
        {spaceId: space.id},
        {consistency: "Strong"},
    );

    expect(workspace).toBeNull();
});

test("throws PermissionDeniedError when actor does not have admin access", async () => {
    const space = await TestSpace.create(context);
    const [adminSession, memberSession] = await runAllPromises([
        space.createSession({role: "Admin"}),
        space.createSession({role: "Member"}),
    ]);
    await connectWorkspace(adminSession);

    await expect(
        disconnectSlackWorkspace(memberSession.action(), {spaceId: space.id, workspaceId}),
    ).rejects.toThrow(PermissionDeniedError);
});

// Simulates the Slack API returning `account_inactive` or `token_revoked`. The
// `SlackContextModule` treats these as successful uninstalls since the app is
// already effectively disconnected from the workspace.
test("removes workspace from database when Slack reports token is inactive or revoked", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    const slack = new ConfigurableUninstallSlackContextModule({ok: true});

    await disconnectSlackWorkspace(actionWithSlack(adminSession, slack), {
        spaceId: space.id,
        workspaceId,
    });

    const workspace = await getConnectedSlackWorkspaceIfExists(
        adminSession.action(),
        {spaceId: space.id},
        {consistency: "Strong"},
    );

    expect(workspace).toBeNull();
});

test("throws PermissionDeniedError and preserves workspace when Slack returns access_denied", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    // Simulates the Slack API returning `access_denied` or `no_permission`. The
    // `SlackContextModule` translates these to a `PermissionDeniedError` and returns
    // `{ok: false}`, so the workspace should NOT be deleted from the database.
    const uninstallError = new PermissionDeniedError(
        "Permission denied attempting to uninstall Alpine app from Slack workspace",
    );
    const slack = new ConfigurableUninstallSlackContextModule({ok: false, error: uninstallError});

    await expect(
        disconnectSlackWorkspace(actionWithSlack(adminSession, slack), {
            spaceId: space.id,
            workspaceId,
        }),
    ).rejects.toThrow("Permission denied attempting to uninstall Alpine app from Slack workspace");

    const workspace = await getConnectedSlackWorkspaceIfExists(
        adminSession.action(),
        {spaceId: space.id},
        {consistency: "Strong"},
    );

    expect(workspace?.workspaceId).toBe(workspaceId);
});

test("throws UnknownError and preserves workspace when Slack returns an unexpected error", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    // Simulates the Slack API returning an unexpected error code. The
    // `SlackContextModule` translates these to an `UnknownError`, so the workspace
    // should NOT be deleted.
    const uninstallError = new UnknownError("Failed to uninstall Alpine app from Slack workspace");
    const slack = new ConfigurableUninstallSlackContextModule({ok: false, error: uninstallError});

    await expect(
        disconnectSlackWorkspace(actionWithSlack(adminSession, slack), {
            spaceId: space.id,
            workspaceId,
        }),
    ).rejects.toThrow("Failed to uninstall Alpine app from Slack workspace");

    const workspace = await getConnectedSlackWorkspaceIfExists(
        adminSession.action(),
        {spaceId: space.id},
        {consistency: "Strong"},
    );

    expect(workspace?.workspaceId).toBe(workspaceId);
});
