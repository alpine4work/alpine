import {AnyBlock} from "@slack/web-api";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SlackBotOAuthScopes} from "~/shared/integrations/slack/slack_bot_oauth_scopes.js";
import {SlackAccount} from "~/shared/integrations/slack/slack_space_integration_schema.js";

export abstract class SlackContextModuleBase<
    Modules extends {
        tracer: TracerContextModule;
    } = {
        tracer: TracerContextModule;
    },
> extends ContextModuleBase<Modules> {
    abstract getOAuthUrl({
        spaceId,
        state,
        workspaceId,
    }: {
        spaceId: SpaceId;
        state: string;
        workspaceId?: string;
    }): Promise<string>;

    abstract exchangeShortLivedOAuthCodeForAccessToken(
        context: ServerSessionActionContext,
        {code, spaceId}: {code: string; spaceId: SpaceId},
    ): Promise<{
        workspaceId: string;
        slackUserId: string;
        botToken: string;
        botUserId: string;
        botScopes: SlackBotOAuthScopes;
    }>;

    abstract getUserProfile(
        context: ServerActionContext,
        {spaceId, slackUserId}: {spaceId: SpaceId; slackUserId: string},
    ): Promise<SlackAccount & {email?: string}>;

    abstract getWorkspaceInfo(
        context: ServerActionContext,
        {spaceId, workspaceId}: {spaceId: SpaceId; workspaceId: string},
    ): Promise<{workspaceName: string; workspaceImageUrl: string; workspaceUrl?: string}>;

    abstract sendDirectMessageAsAlpineApp(
        context: ServerActionContext,
        {
            spaceId,
            slackUserId,
            text,
            blocks,
        }: {
            spaceId: SpaceId;
            slackUserId: string;
            text: string;
            blocks?: Array<AnyBlock>;
        },
    ): Promise<void>;

    abstract uninstallAlpineAppFromSlackWorkspace(
        context: ServerActionContext,
        {spaceId}: {spaceId: SpaceId},
    ): Promise<{ok: boolean; error?: ErrorBase}>;

    abstract fork(): SlackContextModuleBase;
}
