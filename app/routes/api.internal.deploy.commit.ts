import {getDeploy} from "~/server/deploy/data/deploy_table.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {quote} from "~/shared/helpers/string/quote.js";

export async function loader({request, context, span}: LoaderArgs) {
    try {
        if (request.method !== "GET") throw new InvalidArgumentError("Must use GET HTTP method");

        const url = new URL(request.url);
        const status = url.searchParams.get("status") ?? "current";

        if (status !== "current" && status !== "ongoing") {
            throw new InvalidArgumentError(quote`Unexpected status search param: ${status}`);
        }

        const deploy = await getDeploy(context);

        return new Response(
            status === "ongoing"
                ? deploy.ongoingDeployment?.commitSha ?? deploy.commitSha
                : deploy.commitSha,
            {
                status: 200,
                headers: {"content-type": "text/plain"},
            },
        );
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
