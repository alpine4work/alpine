import {redirect} from "@remix-run/router";
import {LoaderArgs} from "~/server/remix/loader_context.js";

export async function loader({context}: LoaderArgs) {
    (await context.loader.getSessionCookie()).unsetSessionId();
    return redirect("/");
}
