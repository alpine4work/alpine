import {redirect} from "@remix-run/router";
import {parse, serialize} from "cookie";
import {useEffect} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount} from "~/server/integrations/slack/exchange_oauth_code_for_token_and_connect_slack_workspace_and_account.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {hasSlackIntegrationSettingsFeature} from "~/shared/integrations/has_slack_integration_settings_feature.js";
import {
    SlackOAuthStatusMessageSchema,
    slackOAuthStatusMessageType,
    slackOAuthWindowName,
} from "~/shared/integrations/slack/slack_oauth_status_message_schema.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    success: Schema.boolean,
    error: ErrorSchema.nullable(),
});

/**
 * This route is used to handle the OAuth callback from Slack after the user has authorized the
 * Slack Alpine app. It is used to exchange the short-lived OAuth code that Slack puts in the
 * search params for an long-lived access token, which we store in the database and use to
 * authenticate as the Alpine bot when we need to make API calls to Slack.
 *
 * We send this route as the `redirect_uri` when we initiate a request for an OAuth code from
 * Slack. It is expected that this route is only opened within a temporary popup window and is
 * closed after the OAuth flow is complete. For more details on the OAuth flow, see the README.md
 * file in the `server/integrations/slack` directory.
 */
export async function loader({context, params, request}: LoaderArgs) {
    if (!hasSlackIntegrationSettingsFeature()) {
        return redirect(`/s/${params.spaceId}/settings/integrations`);
    }

    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const authenticatedContext = (await context.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const code = url.searchParams.get("code");

    if (!code) {
        return redirect(`/s/${params.spaceId}/settings/integrations/slack`);
    }

    const state = url.searchParams.get("state");
    const cookies = parse(request.headers.get("cookie") ?? "");
    const expectedState = cookies[`slackOAuthState${context.loader.cookieNameSuffix}`];

    // Set the state cookie to an empty string and expire it immediately.
    const clearStateCookie = serialize(`slackOAuthState${context.loader.cookieNameSuffix}`, "", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        expires: new Date(0),
    });

    if (!state || !expectedState || state !== expectedState) {
        const response = jsonWithSchema(LoaderSchema, {
            success: false,
            error: new InvalidArgumentError("Invalid or expired OAuth state"),
        });
        response.headers.append("set-cookie", clearStateCookie);
        return response;
    }

    // Exchange the short-lived OAuth code for an access token and connect the Slack workspace and
    // account if not already connected.
    try {
        await exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
            authenticatedContext,
            {
                code: assertExists(code),
                spaceId,
            },
        );
        const response = jsonWithSchema(LoaderSchema, {
            success: true,
            error: null,
        });
        response.headers.append("set-cookie", clearStateCookie);
        return response;
    } catch (error) {
        const response = jsonWithSchema(LoaderSchema, {
            success: false,
            error,
        });
        response.headers.append("set-cookie", clearStateCookie);
        return response;
    }
}

export default function SpaceSlackOAuthRoute() {
    const {success, error} = useLoaderDataWithSchema(LoaderSchema);

    const {space} = useSpaceContextAndRequireSpaceAccess();

    useEffect(() => {
        // If this page is loaded from the Slack OAuth popup, send a message back to the parent
        // page to report the authentication status and close the popup. The parent page is
        // responsible for refetching data and displaying any errors.
        if (window.name === slackOAuthWindowName && window.opener) {
            const opener = cast<Window>(window.opener);
            opener.postMessage(
                SlackOAuthStatusMessageSchema.serialize({
                    type: slackOAuthStatusMessageType,
                    success,
                    error,
                }),
                "/",
            );
            opener.focus();
            window.close();
        }
    }, [space.id, success, error]);

    return null;
}
