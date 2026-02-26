import {AnyBlock, WebClient} from "@slack/web-api";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {getConnectedSlackWorkspaceBotCredentialsIfExists} from "~/server/integrations/slack/get_connected_slack_workspace_bot_credentials_if_exists.js";
import {ContextCache} from "~/shared/context/cache_context_module.js";
import {NotFoundError, UnknownError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {slackBotOAuthScopes} from "~/shared/integrations/slack/slack_bot_oauth_scopes.js";

/**
 * Per-request cache of authenticated `WebClient`s, keyed by spaceId. Concurrent API calls within
 * the same request cycle for the same space share the same bot credentials.
 */
const slackAuthenticatedBotClientCache = new ContextCache<SpaceId, WebClient>({
    whenActorChanges: "SafelyReset",
});

export class SlackContextModule extends SlackContextModuleBase {
    private readonly _clientId: string;
    private readonly _clientSecret: string;
    // We pass in and store the base URL so we can construct an absolute redirect URI for the OAuth
    // flow.
    private readonly _authRedirectOrigin: string;

    constructor({
        clientId,
        clientSecret,
        authRedirectOrigin,
    }: {
        clientId: string;
        clientSecret: string;
        authRedirectOrigin: string;
    }) {
        super();
        this._clientId = clientId;
        this._clientSecret = clientSecret;
        this._authRedirectOrigin = authRedirectOrigin;
    }

    private getRedirectUri(spaceId: SpaceId): string {
        return `${this._authRedirectOrigin}/s/${spaceId}/integrations/slack/oauth`;
    }

    /**
     * Returns an authenticated WebClient for the given space, fetching bot credentials from the
     * database if not yet cached for this request. Validates space access as part of the
     * credential lookup.
     */
    private _getAuthenticatedBotClientForSpace(
        context: ServerActionContext,
        spaceId: SpaceId,
    ): Promise<WebClient> {
        return slackAuthenticatedBotClientCache.get(context, spaceId, async () => {
            const credentials = await getConnectedSlackWorkspaceBotCredentialsIfExists(context, {
                spaceId,
            });
            if (!credentials) {
                throw new NotFoundError("Slack workspace integration not found");
            }
            return new WebClient(credentials.botToken);
        });
    }

    public async getOAuthUrl(spaceId: SpaceId, state: string): Promise<string> {
        const redirectUri = this.getRedirectUri(spaceId);

        const botScopes = Array.from(slackBotOAuthScopes).join(",");

        return `https://slack.com/oauth/v2/authorize?scope=${botScopes}&client_id=${this._clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    }

    public async exchangeShortLivedOAuthCodeForAccessToken(
        context: ServerSessionActionContext,
        {code, spaceId}: {code: string; spaceId: SpaceId},
    ) {
        const unauthenticatedWebClient = new WebClient();

        const response = await unauthenticatedWebClient.oauth.v2.access({
            code,
            client_id: this._clientId,
            client_secret: this._clientSecret,
            grant_type: "authorization_code",
            redirect_uri: this.getRedirectUri(spaceId),
        });

        if (!response.ok) {
            throw new UnknownError("Failed to exchange Slack OAuth code for access token", {
                cause: response.error,
            });
        }

        const workspaceId = assertExists(response.team?.id);
        const slackUserId = assertExists(response.authed_user?.id);
        const botToken = assertExists(response.access_token);
        const botUserId = assertExists(response.bot_user_id);
        const botScopes = new Set(response.scope?.split(",") ?? []);

        // Seed the cache so subsequent API calls in this request cycle don't need to fetch the
        // token from the database.
        slackAuthenticatedBotClientCache.set(context, spaceId, new WebClient(botToken));

        return {workspaceId, slackUserId, botToken, botUserId, botScopes};
    }

    public async getUserProfile(
        context: ServerActionContext,
        {spaceId, slackUserId}: {spaceId: SpaceId; slackUserId: string},
    ) {
        const client = await this._getAuthenticatedBotClientForSpace(context, spaceId);

        const profileResponse = await client.users.profile.get({
            user: slackUserId,
        });

        if (!profileResponse.ok) {
            throw new UnknownError("Failed to get Slack user profile", {
                cause: profileResponse.error,
            });
        }

        return {
            slackUserId,
            displayName: profileResponse.profile?.display_name,
            realName: profileResponse.profile?.real_name,
            email: profileResponse.profile?.email,
            profileImageUrl: assertExists(profileResponse.profile?.image_512),
        };
    }

    public async getWorkspaceInfo(
        context: ServerActionContext,
        {spaceId, workspaceId}: {spaceId: SpaceId; workspaceId: string},
    ) {
        const client = await this._getAuthenticatedBotClientForSpace(context, spaceId);

        const workspaceInfoResponse = await client.team.info({
            team: workspaceId,
        });
        if (!workspaceInfoResponse.ok) {
            throw new UnknownError("Failed to get Slack workspace info", {
                cause: workspaceInfoResponse.error,
            });
        }
        return {
            workspaceName: assertExists(workspaceInfoResponse.team?.name),
            workspaceImageUrl: assertExists(workspaceInfoResponse.team?.icon?.image_230),
        };
    }

    public async sendDirectMessageAsAlpineApp(
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
    ) {
        const client = await this._getAuthenticatedBotClientForSpace(context, spaceId);

        await client.chat.postMessage({
            channel: slackUserId,
            text,
            blocks: blocks ?? [],
        });
    }

    public async uninstallAlpineAppFromSlackWorkspace(
        context: ServerActionContext,
        {spaceId}: {spaceId: SpaceId},
    ) {
        const client = await this._getAuthenticatedBotClientForSpace(context, spaceId);

        const uninstallResponse = await client.apps.uninstall({
            client_id: this._clientId,
            client_secret: this._clientSecret,
        });

        if (!uninstallResponse.ok) {
            throw new UnknownError("Failed to uninstall Alpine app from Slack workspace", {
                cause: uninstallResponse.error,
            });
        }
    }

    fork(): SlackContextModuleBase {
        return new SlackContextModule({
            clientId: this._clientId,
            clientSecret: this._clientSecret,
            authRedirectOrigin: this._authRedirectOrigin,
        });
    }
}
