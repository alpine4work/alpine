/* eslint-disable @typescript-eslint/no-unused-vars */
import {AnyBlock} from "@slack/web-api";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/** No-op implementation for tests. Makes no network calls. */
export class NoopSlackContextModule extends SlackContextModuleBase {
    constructor() {
        assert(
            process.env.NODE_ENV !== "production",
            "NoopSlackContextModule can only be instantiated in a non-production environment",
        );
        super();
    }

    public async getOAuthUrl(_params: {
        spaceId: SpaceId;
        state: string;
        workspaceId?: string;
    }): Promise<string> {
        return "https://test.cyberworlds.dev";
    }

    public async exchangeShortLivedOAuthCodeForAccessToken(
        _context: ServerSessionActionContext,
        _params: {code: string; spaceId: SpaceId},
    ) {
        return {
            workspaceId: "test-workspace-id",
            slackUserId: "test-slack-user-id",
            botToken: "test-bot-token",
            botUserId: "test-bot-user-id",
            botScopes: new Set<string>(),
        };
    }

    public async getUserProfile(
        _context: ServerActionContext,
        _params: {spaceId: SpaceId; slackUserId: string},
    ) {
        return {
            slackUserId: "test-slack-user-id",
            displayName: "Test User",
            profileImageUrl: "https://test.cyberworlds.dev/avatar.png",
        };
    }

    public async getWorkspaceInfo(
        _context: ServerActionContext,
        _params: {spaceId: SpaceId; workspaceId: string},
    ) {
        return {
            workspaceName: "Test Workspace",
            workspaceImageUrl: "https://test.cyberworlds.dev/workspace-icon.png",
        };
    }

    public async sendDirectMessageAsAlpineApp(
        _context: ServerActionContext,
        _params: {spaceId: SpaceId; slackUserId: string; text: string; blocks?: Array<AnyBlock>},
    ) {
        // No-op for test environment.
    }

    public async uninstallAlpineAppFromSlackWorkspace(
        _context: ServerActionContext,
        _params: {spaceId: SpaceId},
    ): Promise<{ok: boolean; error?: ErrorBase}> {
        return {ok: true};
    }

    fork(): SlackContextModuleBase {
        return new NoopSlackContextModule();
    }
}
