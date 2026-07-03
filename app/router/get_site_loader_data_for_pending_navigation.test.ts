import {getSiteLoaderDataForPendingNavigation} from "~/app/router/get_site_loader_data_for_pending_navigation.js";

const siteId = "qgcfk3nxt8f8yax2p1cqs4x62w";
const otherSiteId = "qvp9zxq9y129gqznhbkqgxc2vr";
const documentId = "wn09v2jgvm621fbm5mckg7pp6r";
const taskId = "jcw393m4ah1maa94xc5s5mnyk0";

// `jest-environment-jsdom` doesn't implement the Fetch API, so there's no
// `Request` global. The function under test only reads `url` and `headers.get()`,
// so stub those rather than construct a real `Request`. Resolving against
// `window.location.href` keeps the URL same-host, which
// `parseSearchEntityIdFromUrl` requires.
function createRequest(pathname: string, activeSiteId?: string): Request {
    return {
        url: new URL(pathname, window.location.href).toString(),
        headers: {
            get: (name: string) =>
                name === "cyberworlds-active-site-id" ? (activeSiteId ?? null) : null,
        },
    } as unknown as Request;
}

test("synthesizes `UseActiveSite` for an entity route", () => {
    expect(
        getSiteLoaderDataForPendingNavigation({
            routeId: "routes/_space.doc.$documentId._index",
            request: createRequest(`/doc/${documentId}`, siteId),
            params: {documentId},
        }),
    ).toEqual({type: "UseActiveSite", siteId, activeEntityId: `Document:${documentId}`});
});

test("synthesizes `UseActiveSite` for a peek entity route", () => {
    expect(
        getSiteLoaderDataForPendingNavigation({
            routeId: "routes/_space.peek.task.$taskId._index",
            request: createRequest(`/task/${taskId}`, siteId),
            params: {taskId},
        }),
    ).toEqual({type: "UseActiveSite", siteId, activeEntityId: `Task:${taskId}`});
});

test("returns undefined without the active site header", () => {
    expect(
        getSiteLoaderDataForPendingNavigation({
            routeId: "routes/_space.doc.$documentId._index",
            request: createRequest(`/doc/${documentId}`),
            params: {documentId},
        }),
    ).toBeUndefined();
});

test("returns undefined for an invalid active site header", () => {
    expect(
        getSiteLoaderDataForPendingNavigation({
            routeId: "routes/_space.doc.$documentId._index",
            request: createRequest(`/doc/${documentId}`, "not-an-id"),
            params: {documentId},
        }),
    ).toBeUndefined();
});

test("returns undefined for a route that doesn\u2019t publish site loader data", () => {
    expect(
        getSiteLoaderDataForPendingNavigation({
            routeId: "routes/_space.inbox.$spaceId",
            request: createRequest("/inbox", siteId),
            params: {},
        }),
    ).toBeUndefined();
});

test("returns undefined for an invalid entity route param", () => {
    expect(
        getSiteLoaderDataForPendingNavigation({
            routeId: "routes/_space.doc.$documentId._index",
            request: createRequest("/doc/not-an-id", siteId),
            params: {documentId: "not-an-id"},
        }),
    ).toBeUndefined();
});

test("synthesizes `UseActiveSite` without an entity for the site root", () => {
    expect(
        getSiteLoaderDataForPendingNavigation({
            routeId: "routes/_space.site.$siteId._index",
            request: createRequest(`/site/${siteId}`, siteId),
            params: {siteId},
        }),
    ).toEqual({type: "UseActiveSite", siteId});
});

test("returns undefined when the header names a different site than the site route", () => {
    expect(
        getSiteLoaderDataForPendingNavigation({
            routeId: "routes/_space.site.$siteId._index",
            request: createRequest(`/site/${siteId}`, otherSiteId),
            params: {siteId},
        }),
    ).toBeUndefined();
});

test("reads the active entity from the navigate route\u2019s search param", () => {
    expect(
        getSiteLoaderDataForPendingNavigation({
            routeId: "routes/_space.site.$siteId.navigate",
            request: createRequest(
                `/site/${siteId}/navigate?activeEntityId=${encodeURIComponent(
                    `Document:${documentId}`,
                )}`,
                siteId,
            ),
            params: {siteId},
        }),
    ).toEqual({type: "UseActiveSite", siteId, activeEntityId: `Document:${documentId}`});
});

test("omits the active entity for an invalid navigate route search param", () => {
    expect(
        getSiteLoaderDataForPendingNavigation({
            routeId: "routes/_space.site.$siteId.navigate",
            request: createRequest(
                `/site/${siteId}/navigate?activeEntityId=not-an-entity-id`,
                siteId,
            ),
            params: {siteId},
        }),
    ).toEqual({type: "UseActiveSite", siteId, activeEntityId: undefined});
});
