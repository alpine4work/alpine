import {redirect} from "@remix-run/cloudflare";
import {DataFunctionArgs} from "~/server/helpers/remix/data_function_args";

export async function loader({context}: DataFunctionArgs) {
    await context.sessionCookie.unsetSessionId();
    return redirect("/");
}
