import {LoaderArgs} from "~/server/remix/loader_context.js";
import {attemptOneTimePasswordSignUpThenCreateSpace} from "~/server/spaces/create/attempt_one_time_password_sign_up_then_create_space.js";
import {getRequestIpAddress} from "~/server/tracer/trace_server_response.js";
import {
    AuthSignInOrSignUpOutputSchema,
    AuthSignUpInputSchema,
} from "~/shared/auth/auth_sign_in_or_sign_up_schema.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {quote} from "~/shared/helpers/string/quote.js";

export async function action({request, context, span}: LoaderArgs) {
    try {
        if (request.method !== "POST")
            throw new InvalidArgumentError(quote`Invalid HTTP method: ${request.method}`);

        const input = AuthSignUpInputSchema.deserialize(await request.json());

        const {sessionId, sessionAccountId, openSpaceId} =
            await attemptOneTimePasswordSignUpThenCreateSpace(context, {
                emailAddress: input.emailAddress,
                oneTimePassword: input.oneTimePassword,
                inviteEmailAddresses: input.inviteEmailAddresses,
                ipAddress: getRequestIpAddress(request),
                userAgent: request.headers.get("user-agent"),
            });

        // This is what actually signs the account in!
        context.loader.sessionCookie.dangerouslySet({
            type: "Session",
            sessionId,
            accountId: sessionAccountId,
        });

        return new Response(
            JSON.stringify(
                AuthSignInOrSignUpOutputSchema.serialize({
                    ok: true,
                    openSpaceId,
                }),
            ),
            {
                status: 200,
                headers: {"content-type": "application/json"},
            },
        );
    } catch (error) {
        span.addException(error);

        const status = isSystemError(error) ? 500 : 400;

        return new Response(
            JSON.stringify(
                AuthSignInOrSignUpOutputSchema.serialize({
                    ok: false,
                    error,
                }),
            ),
            {
                status,
                headers: {"content-type": "application/json"},
            },
        );
    }
}
