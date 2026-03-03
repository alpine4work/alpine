export async function action() {
    // TODO (rmtobin, 2026-02-18):Implement an actual response to Slack interactivity
    // events. Slack sends us interactivity payloads whenever a user interacts with an
    // interactive element in a message. We have to respond to these with a 200 OK
    // response to let Slack know we've received the event or they show an error to the
    // user in Slack.
    return new Response("OK", {
        status: 200,
        headers: {"content-type": "text/plain"},
    });
}
