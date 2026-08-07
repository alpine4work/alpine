import {parse, serialize} from "cookie";
import {useEffect, useRef} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/context/space_context.js";
import {exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount} from "~/server/integrations/slack/exchange_oauth_code_for_token_and_connect_slack_workspace_and_account.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    ErrorBase,
    InvalidArgumentError,
    PermissionDeniedError,
    UnavailableError,
    UnknownError,
} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {
    SlackOAuthStatusMessageSchema,
    slackOAuthStatusMessageType,
    slackOAuthWindowName,
} from "~/shared/integrations/slack/slack_oauth_status_message_schema.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

const LoaderSchema = Schema.object({
    ok: Schema.boolean,
    error: ErrorSchema.nullable(),
});

/**
 * This route is used to handle the OAuth callback from Slack after the user has
 * authorized the Slack Alpine app. It exchanges the short-lived OAuth code that
 * Slack puts in the search params for an long-lived access token, which we store
 * in the database and use to authenticate as the Alpine bot in a workspace when we
 * need to make Slack API calls.
 *
 * We send this route as the `redirect_uri` when we initiate a request for an OAuth
 * code. It is expected that this route is only opened within a temporary popup
 * window and is closed after the OAuth flow is complete. For more details on the
 * OAuth flow, see the README.md file in the `server/integrations/slack` directory.
 */
export async function loader({context, params, request}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const authenticatedContext = (await context.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const code = url.searchParams.get("code");

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

    // If the state is missing or mismatched, the request may not have come from us, so
    // we return an error.
    if (!state || !expectedState || state !== expectedState) {
        const response = jsonWithSchema(LoaderSchema, {
            ok: false,
            error: new InvalidArgumentError("Invalid or expired OAuth state"),
        });
        response.headers.append("set-cookie", clearStateCookie);
        return response;
    }

    // Slack returns an error string in the search params if the OAuth flow fails.
    if (url.searchParams.get("error")) {
        const errorMessage = url.searchParams.get("error");

        let error: ErrorBase;
        // Possible Slack API errors:
        // https://docs.slack.dev/reference/methods/oauth.v2.access#errors
        switch (errorMessage) {
            case "access_denied":
            case "account_inactive":
                error = new PermissionDeniedError(
                    "Slack account is inactive or access was denied",
                    {
                        cause: errorMessage,
                        displayMessage: errorDisplayMessage`You do not have permission to access this Slack workspace.`,
                    },
                );
                break;

            case "ratelimited":
            case "request_timeout":
            case "service_unavailable":
                error = new UnavailableError(`Slack API service failure`, {
                    cause: errorMessage,
                });
                break;
            case "invalid_auth":
            case "invalid_code":
                error = new InvalidArgumentError("Invalid or expired Slack OAuth state");
                break;
            default:
                error = new UnknownError(`Unknown Slack OAuth error`, {
                    cause: errorMessage,
                });
        }

        const response = jsonWithSchema(LoaderSchema, {
            ok: false,
            error,
        });

        response.headers.append("set-cookie", clearStateCookie);

        return response;
    } else if (!code) {
        const response = jsonWithSchema(LoaderSchema, {
            ok: false,
            error: new InvalidArgumentError("No OAuth code found"),
        });
        response.headers.append("set-cookie", clearStateCookie);
        return response;
    }

    // Exchange the short-lived OAuth code for an access token and connect the Slack
    // workspace and account if not already connected.
    try {
        await exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount(
            authenticatedContext,
            {
                code: assertExists(code),
                spaceId,
            },
        );
        const response = jsonWithSchema(LoaderSchema, {
            ok: true,
            error: null,
        });
        response.headers.append("set-cookie", clearStateCookie);
        return response;
    } catch (error) {
        const response = jsonWithSchema(LoaderSchema, {
            ok: false,
            error,
        });
        response.headers.append("set-cookie", clearStateCookie);
        return response;
    }
}

export default function SpaceSlackOAuthRoute() {
    const {ok, error} = useLoaderDataWithSchema(LoaderSchema);

    const {space} = useSpaceContextAndRequireSpaceAccess();
    const rootNavigate = useRootNavigate();

    const hasInitiallyMountedRef = useRef(false);

    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        // If this page is loaded from the Slack OAuth popup, send a message back to the
        // parent page to report the authentication status and close the popup. The parent
        // page is responsible for refetching data and displaying any errors.
        if (window.name === slackOAuthWindowName && window.opener) {
            const opener = cast<Window>(window.opener);
            opener.postMessage(
                SlackOAuthStatusMessageSchema.serialize({
                    type: slackOAuthStatusMessageType,
                    ok,
                    error,
                }),
                "/",
            );
            opener.focus();
            window.close();
        } else {
            // If for some reason you ended up on this page on your own, redirect to the
            // settings page.
            rootNavigate(`/settings/${space.id}/integrations/slack`);
        }
    }, [space.id, ok, error, rootNavigate]);

    return null;
}
