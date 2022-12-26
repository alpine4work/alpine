import {DataFunctionArgs} from "~/server/helpers/remix/data_function_args";
import {ErrorSchema} from "~/shared/error/error_schema";
import {isHttp500Error} from "~/shared/error/is_http_500_error_code";

export async function action({request, context}: DataFunctionArgs) {
    try {
        const events = await request.json();

        // TODO(calebmer): Validate events from client and send to Honeycomb.
        for (const event of events as any) {
            // eslint-disable-next-line no-console
            console.log(event);
        }

        return new Response(JSON.stringify({ok: true}), {
            status: 200,
            headers: {"content-type": "application/json"},
        });
    } catch (error) {
        const status = isHttp500Error(error) ? 500 : 400;

        return new Response(JSON.stringify({ok: false, error: ErrorSchema.serialize(error)}), {
            status,
            headers: {"content-type": "application/json"},
        });
    }
}
