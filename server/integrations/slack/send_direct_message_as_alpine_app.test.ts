import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSlackAccountIntegration} from "~/server/integrations/slack/create_slack_account_integration.js";
import {createSlackWorkspaceIntegration} from "~/server/integrations/slack/create_slack_workspace_integration.js";
import {sendDirectMessageAsAlpineApp} from "~/server/integrations/slack/send_direct_message_as_alpine_app.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
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

test("sends direct message successfully when workspace and account are connected", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);
    await connectAccount(adminSession);

    // The NoopSlackContextModule makes no network calls, so this succeeds without
    // error.
    await sendDirectMessageAsAlpineApp(adminSession.action(), {
        spaceId: space.id,
        accountId: adminSession.account.id,
        template: {
            templateName: "SlackAlpineNotification",
            templateArgs: {
                title: "New task assigned",
                body: "A task has been assigned to you",
                entryUrl: "https://example.com/task/1",
            },
        },
    });
});

test("throws NotFoundError when no Slack workspace is connected to the space", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    await expect(
        sendDirectMessageAsAlpineApp(adminSession.action(), {
            spaceId: space.id,
            accountId: adminSession.account.id,
            template: {
                templateName: "SlackAlpineNotification",
                templateArgs: {
                    title: "Test",
                    body: "Body",
                    entryUrl: "https://example.com",
                },
            },
        }),
    ).rejects.toThrow("Slack workspace integration not found");
});

test("throws NotFoundError when account has no Slack account connected", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    await expect(
        sendDirectMessageAsAlpineApp(adminSession.action(), {
            spaceId: space.id,
            accountId: adminSession.account.id,
            template: {
                templateName: "SlackAlpineNotification",
                templateArgs: {
                    title: "Test",
                    body: "Body",
                    entryUrl: "https://example.com",
                },
            },
        }),
    ).rejects.toThrow("Slack user integration not found");
});

test("throws NotFoundError when an explicit workspaceId has no bot credentials", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    await connectWorkspace(adminSession);

    await expect(
        sendDirectMessageAsAlpineApp(adminSession.action(), {
            spaceId: space.id,
            accountId: adminSession.account.id,
            workspaceId: "W-does-not-exist",
            template: {
                templateName: "SlackAlpineNotification",
                templateArgs: {
                    title: "Test",
                    body: "Body",
                    entryUrl: "https://example.com",
                },
            },
        }),
    ).rejects.toThrow("Slack workspace integration not found");
});

test("throws PermissionDeniedError when actor does not have space access", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const outsiderSession = await otherSpace.createSession({role: "Member"});

    await expect(
        sendDirectMessageAsAlpineApp(outsiderSession.action(), {
            spaceId: space.id,
            accountId: outsiderSession.account.id,
            template: {
                templateName: "SlackAlpineNotification",
                templateArgs: {
                    title: "Test",
                    body: "Body",
                    entryUrl: "https://example.com",
                },
            },
        }),
    ).rejects.toThrow(PermissionDeniedError);
});
