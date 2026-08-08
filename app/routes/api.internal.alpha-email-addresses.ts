import {getAllApprovedAlphaAccessRequestEmailAddresses} from "~/server/alpha/alpha_access_table.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";

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
