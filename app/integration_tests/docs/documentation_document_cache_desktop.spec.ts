import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

createTestServices();

test("does not share personalized documentation documents between browsers", async ({
    playwright,
    baseURL,
}) => {
    const url = assertExists(baseURL);
    const visitor1 = await playwright.request.newContext({baseURL: url});
    const visitor2 = await playwright.request.newContext({baseURL: url});

    try {
        await visitor1.get("/blog");
        await visitor2.get("/blog");
        const visitor1Response = await visitor1.get("/blog");
        const visitor2Response = await visitor2.get("/blog");
        const visitor1Body = await visitor1Response.text();
        const visitor2Body = await visitor2Response.text();
        const visitor1BrowserId = browserIdFromStorageState(await visitor1.storageState());
        const visitor2BrowserId = browserIdFromStorageState(await visitor2.storageState());
        const visitor1Headers = visitor1Response.headers();
        const visitor2Headers = visitor2Response.headers();

        expect({
            browserIdsDiffer: visitor1BrowserId !== visitor2BrowserId,
            visitor1ContainsOwnId: visitor1Body.includes(visitor1BrowserId),
            visitor1ContainsOtherId: visitor1Body.includes(visitor2BrowserId),
            visitor2ContainsOwnId: visitor2Body.includes(visitor2BrowserId),
            visitor2ContainsOtherId: visitor2Body.includes(visitor1BrowserId),
            visitor1CacheControl: visitor1Headers["cache-control"],
            visitor2CacheControl: visitor2Headers["cache-control"],
            visitor1CloudflareCacheControl: visitor1Headers["cloudflare-cdn-cache-control"],
            visitor2CloudflareCacheControl: visitor2Headers["cloudflare-cdn-cache-control"],
            visitor1SetCookie: visitor1Headers["set-cookie"],
            visitor2SetCookie: visitor2Headers["set-cookie"],
        }).toEqual({
            browserIdsDiffer: true,
            visitor1ContainsOwnId: true,
            visitor1ContainsOtherId: false,
            visitor2ContainsOwnId: true,
            visitor2ContainsOtherId: false,
            visitor1CacheControl: "private, no-store",
            visitor2CacheControl: "private, no-store",
            visitor1CloudflareCacheControl: undefined,
            visitor2CloudflareCacheControl: undefined,
            visitor1SetCookie: undefined,
            visitor2SetCookie: undefined,
        });
    } finally {
        await visitor1.dispose();
        await visitor2.dispose();
    }
});

function browserIdFromStorageState({
    cookies,
}: {
    cookies: Array<{name: string; value: string}>;
}): string {
    const browserCookie = assertExists(
        cookies.find(cookie => cookie.name.startsWith("browser")),
        "Expected browser cookie",
    );
    return assertExists(decodeURIComponent(browserCookie.value).split("@")[0]);
}
