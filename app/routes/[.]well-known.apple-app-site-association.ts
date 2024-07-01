import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {idLength} from "~/shared/id/id.js";

// TODO(calebmer): Finish deep link support, I need to wait for a deploy:
// https://cyberworlds.dev/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/n6sqts9cn2pvh92ad2sqq96xnr
export async function loader({request, span}: LoaderArgs) {
    try {
        if (request.method !== "GET") throw new InvalidArgumentError("Must use GET HTTP method");

        // Documentation for this format lives here:
        // https://developer.apple.com/documentation/bundleresources/applinks
        const response = {
            applinks: {
                details: [
                    {
                        appIDs: [
                            "Y4DS5YUGFX.dev.cyberworlds.mobile.app",
                            "Y4DS5YUGFX.inc.alpine.mobile.app",
                        ],
                        components: [
                            {"/": `/s/${createArrayWithLength(idLength, () => "?").join("")}*`},
                        ],
                    },
                ],
            },
        };

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: {"content-type": "text/plain", "cache-control": "public, max-age=120"},
        });
    } catch (error) {
        span.addException(error);

        return new Response(
            JSON.stringify({
                error: ErrorSchema.serialize(error),
            }),
            {
                status: isSystemError(error) ? 500 : 400,
                headers: {"content-type": "application/json"},
            },
        );
    }
}
