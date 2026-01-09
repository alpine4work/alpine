import {LoaderArgs} from "~/server/remix/loader_context.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";

export async function action({request, context, span}: LoaderArgs) {
    try {
        await context.billing.processStripeWebhook(request, span);

        return new Response("OK", {
            status: 200,
            headers: {"content-type": "text/plain"},
        });
    } catch (error) {
        span.addException(error);

        return new Response(
            JSON.stringify({
                ok: false,
                error: ErrorSchema.serialize(error),
            }),
            {
                status: isSystemError(error) ? 500 : 400,
                headers: {"content-type": "application/json"},
            },
        );
    }
}
