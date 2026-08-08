import {
    documentationRouteHeaders,
    getDocumentationResponseHeaders,
} from "~/app/docs/documentation_response_headers.server.js";

test("marks public generated documentation for the dedicated edge cache", () => {
    expect(getDocumentationResponseHeaders()).toEqual({
        "cache-control": "public, max-age=300, stale-while-revalidate=86400, stale-if-error=604800",
        "cyberworlds-documentation-cache-policy": "GeneratedMetadata",
    });
});

test("keeps personalized documentation documents out of shared caches", () => {
    const headers = documentationRouteHeaders();

    expect({
        cacheControl: headers.get("cache-control"),
        cachePolicy: headers.get("cyberworlds-documentation-cache-policy"),
    }).toEqual({
        cacheControl: "private, no-store",
        cachePolicy: null,
    });
});
