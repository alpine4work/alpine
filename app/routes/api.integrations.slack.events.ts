import {LoaderArgs} from "~/server/remix/loader_context.js";

export async function action({request}: LoaderArgs) {
    if (request.method === "POST") {
        const body = await request.json();

        // This is a special case for the Slack Events API, where we need to
        // prove to Slack that we control this endpoint by returning the challenge
        // before they'll send events to us.
        if (body.type === "url_verification") {
            return new Response(JSON.stringify({challenge: body.challenge}), {
                status: 200,
                headers: {"content-type": "application/json"},
            });
        }
    }
    return new Response("OK", {
        status: 200,
        headers: {"content-type": "text/plain"},
    });
}
