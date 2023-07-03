import {redirect} from "@remix-run/router";
import {LoaderArgs} from "~/server/remix/loader_context.js";

export async function loader({context}: LoaderArgs) {
    context.loader.sessionCookie.dangerouslySet(null);
    return redirect("/");
}
