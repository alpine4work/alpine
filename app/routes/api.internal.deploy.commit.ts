import {getDeploy} from "~/server/deploy/data/deploy_table.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";

export async function loader({request, context, span}: LoaderArgs) {
    try {
        if (request.method !== "GET") throw new InvalidArgumentError("Must use GET HTTP method");

        const url = new URL(request.url);
        const status = url.searchParams.get("status") ?? "current";

        if (status !== "current" && status !== "ongoing" && status !== "scheduled") {
            throw new InvalidArgumentError(quote`Unexpected status search param: ${status}`);
        }

        const deploy = await getDeploy(context);

        let commitSha: string | undefined = undefined;

        // Switch case fallthrough is expected! If there is no scheduled deploy then
        // `status=scheduled` falls back to the ongoing deploy and so on.
        switch (status) {
            case "scheduled":
                commitSha ??= deploy.scheduledDeployment?.commitSha;
            case "ongoing":
                commitSha ??=
                    deploy.ongoingDeployment?.commitSha ?? deploy.dispatchedDeployment?.commitSha;
            case "current":
                commitSha ??= deploy.activeCommitSha;
                break;
            default:
                throw exhaustive(status);
        }

        return new Response(commitSha, {
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
