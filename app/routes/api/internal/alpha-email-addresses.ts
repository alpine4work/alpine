import {getAllApprovedAlphaAccessRequestEmailAddresses} from "~/server/dynamo/alpha_access_table";
import {LoaderArgs} from "~/server/remix/loader_context";
import {InvalidArgumentError} from "~/shared/error/error";
import {ErrorSchema} from "~/shared/error/error_schema";
import {isSystemError} from "~/shared/error/is_system_error_code";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable";

export async function loader({request, context, span}: LoaderArgs) {
    try {
        if (request.method !== "GET") throw new InvalidArgumentError("Must use GET HTTP method");

        const emailAddresses = await arrayFromAsyncIterable(
            getAllApprovedAlphaAccessRequestEmailAddresses(await context.actor.authenticate()),
        );

        return new Response(emailAddresses.join("\n") + "\n", {
            status: 200,
            headers: {"content-type": "text/plain"},
        });
    } catch (error) {
        span.addException(error);

        const status = isSystemError(error) ? 500 : 400;

        return new Response(
            JSON.stringify({
                ok: false,
                error: ErrorSchema.serialize(error),
            }),
            {
                status,
                headers: {"content-type": "application/json"},
            },
        );
    }
}
