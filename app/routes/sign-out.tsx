import {redirect} from "@remix-run/cloudflare";
import {DataFunctionArgs} from "~/server/helpers/types/remix_data_function_args";

export async function loader({context}: DataFunctionArgs) {
    await context.unsetSessionId();
    return redirect("/");
}
