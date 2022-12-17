import {redirect} from "@remix-run/cloudflare";
import {DataFunctionArgs} from "~/server/helpers/types/remix_context";

export async function loader({context}: DataFunctionArgs) {
    (await context.sessionCookie()).unsetSessionId();
    return redirect("/");
}
