import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";

// Chrome has started asking for a new `devtools.json` file to enable certain
// features in developer tools. Provide an implementation of this route for
// Chrome.
//
// Resources:
//
// - https://docs.google.com/document/d/1rfKPnxsNuXhnF7AiQZhu9kIwdiMS5hnAI05HBwFuBSM/edit
// - https://github.com/ChromeDevTools/vite-plugin-devtools-json
export async function loader({request, span}: LoaderArgs) {
    try {
        if (request.method !== "GET") throw new InvalidArgumentError("Must use GET HTTP method");

        if (process.env.NODE_ENV === "production")
            throw new PermissionDeniedError("Only available in development environments");

        return new Response(
            JSON.stringify({
                workspace: {
                    uuid: "4fb0275e-1dd1-44bf-a6c2-f7e486eef48a",
                    root: getWorkspacePath(),
                },
                deployment: {
                    url: "https://alpine.inc",
                },
            }) + "\n",
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
