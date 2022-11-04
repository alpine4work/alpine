import {createRequestHandler, handleAsset} from "@remix-run/cloudflare-workers";
import * as build from "@remix-run/dev/server-build";

const handleRequest = createRequestHandler({build});

const handleEvent = async (event: FetchEvent) => {
    let response;

    if (process.env.NODE_ENV !== "development") {
        response = await handleAsset(event, build);
    }

    if (!response) {
        response = await handleRequest(event);
    }

    return response;
};

addEventListener("fetch", (event: FetchEvent) => {
    event.respondWith(handleEvent(event));
});
