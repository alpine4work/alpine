import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSlackWorkspaceIntegration} from "~/server/integrations/slack/create_slack_workspace_integration.js";
import {exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount} from "~/server/integrations/slack/exchange_oauth_code_for_token_and_connect_slack_workspace_and_account.js";
import {getConnectedSlackAccountIfExists} from "~/server/integrations/slack/get_connected_slack_account_if_exists.js";
import {getConnectedSlackWorkspaceIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_if_exists.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";

// The NoopSlackContextModule always returns these values from
// `exchangeShortLivedOAuthCodeForAccessToken`.
const noopWorkspaceId = "test-workspace-id";
const noopSlackUserId = "test-slack-user-id";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfSlackIntegrationChange: asyncNoop,
    },
});

test("creates both workspace and account when no workspace is connected", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const {slackWorkspace} =
        await exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
            adminSession.action(),
            {code: "test-oauth-code", spaceId: space.id},
        );

    expect(slackWorkspace).toMatchObject({
        workspaceId: noopWorkspaceId,
        workspaceName: "Test Workspace",
    });
});

test("workspace is stored in the database after OAuth connection", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
        adminSession.action(),
        {code: "test-oauth-code", spaceId: space.id},
    );

    const workspace = await getConnectedSlackWorkspaceIfExists(adminSession.action(), {
        spaceId: space.id,
    });

    expect(workspace?.workspaceId).toBe(noopWorkspaceId);
});

test("creates Slack account integration for the actor when workspace is new", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const {slackAccount} =
        await exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
            adminSession.action(),
            {code: "test-oauth-code", spaceId: space.id},
        );

    expect(slackAccount).toMatchObject({
        displayName: "Test User",
    });
});

test("account integration is stored in the database after OAuth connection", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
        adminSession.action(),
        {code: "test-oauth-code", spaceId: space.id},
    );

    const account = await getConnectedSlackAccountIfExists(adminSession.action(), {
        spaceId: space.id,
        workspaceId: noopWorkspaceId,
        accountId: adminSession.account.id,
    });

    expect(account?.slackUserId).toBe(noopSlackUserId);
});

test("returns the existing workspace when the workspace is already connected", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    // Pre-connect the workspace that the NoopSlackContextModule will return.
    await createSlackWorkspaceIntegration(adminSession.action(), {
        spaceId: space.id,
        workspaceId: noopWorkspaceId,
        workspaceName: "Pre-existing Workspace",
        workspaceImageUrl: "https://slack.com/icon.png",
        botToken: "xoxb-pre-existing",
        botUserId: "B-pre-existing",
        botScopes: new Set(),
    });

    const {slackWorkspace} =
        await exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
            adminSession.action(),
            {code: "test-oauth-code", spaceId: space.id},
        );

    expect(slackWorkspace.workspaceName).toBe("Pre-existing Workspace");
});

test("creates only account integration when workspace is already connected", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    // Pre-connect the workspace that the NoopSlackContextModule will return.
    await createSlackWorkspaceIntegration(adminSession.action(), {
        spaceId: space.id,
        workspaceId: noopWorkspaceId,
        workspaceName: "Pre-existing Workspace",
        workspaceImageUrl: "https://slack.com/icon.png",
        botToken: "xoxb-pre-existing",
        botUserId: "B-pre-existing",
        botScopes: new Set(),
    });

    const {slackAccount} =
        await exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
            adminSession.action(),
            {code: "test-oauth-code", spaceId: space.id},
        );

    expect(slackAccount).toMatchObject({displayName: "Test User"});
});

test("throws PermissionDeniedError when actor does not have space access", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const outsiderSession = await otherSpace.createSession({role: "Member"});

    await expect(
        exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
            outsiderSession.action(),
            {code: "test-oauth-code", spaceId: space.id},
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("throws FailedPreconditionError when OAuth workspace ID does not match the already-connected workspace", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    // Pre-connect a workspace with a different ID than what NoopSlackContextModule
    // returns.
    await createSlackWorkspaceIntegration(adminSession.action(), {
        spaceId: space.id,
        workspaceId: "different-workspace-id",
        workspaceName: "Other Workspace",
        workspaceImageUrl: "https://slack.com/icon.png",
        botToken: "xoxb-pre-existing",
        botUserId: "B-pre-existing",
        botScopes: new Set(),
    });

    await expect(
        exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
            adminSession.action(),
            {code: "test-oauth-code", spaceId: space.id},
        ),
    ).rejects.toThrow(
        "The workspace ID in the OAuth response does not match the existing workspace ID",
    );
});
