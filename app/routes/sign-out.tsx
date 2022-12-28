import {redirect} from "@remix-run/cloudflare";
import {LoaderArgs} from "~/server/remix/loader_context";

export async function loader({context}: LoaderArgs) {
    (await context.loader.getSessionCookie()).unsetSessionId();
    return redirect("/");
}
