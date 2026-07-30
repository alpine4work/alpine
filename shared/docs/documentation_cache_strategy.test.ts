import {
    documentationCachePolicyResponseHeader,
    getDocumentationCacheControl,
    getDocumentationResponseCacheHeaders,
    getDocumentationStaticCachePolicy,
    parseDocumentationCachePolicy,
} from "~/shared/docs/documentation_cache_strategy.js";

test("keeps the request-specific user document shell out of every cache", () => {
    expect(getDocumentationResponseCacheHeaders("UserDocument")).toEqual({
        "cache-control": "private, no-store",
    });
});

test("separates browser freshness from the effective generated-data edge TTL", () => {
    expect(getDocumentationResponseCacheHeaders("GeneratedMetadata")).toEqual({
        "cache-control": "public, max-age=300, stale-while-revalidate=86400, stale-if-error=604800",
        [documentationCachePolicyResponseHeader]: "GeneratedMetadata",
    });
});

test("uses only Cache API-supported directives for stable media at the edge", () => {
    expect(getDocumentationCacheControl("StableMedia")).toEqual({
        clientCacheControl: "public, max-age=86400, stale-while-revalidate=604800",
        edgeCacheControl: "public, max-age=604800",
    });
});

test.each(["/docs/guides/documents/og.png", "/blog/example/og.png"])(
    "classifies stable Open Graph image %s",
    pathname => {
        expect(getDocumentationStaticCachePolicy(pathname)).toBe("StableMedia");
    },
);

test.each(["api", "blog", "docs"])(
    "classifies fingerprinted %s documentation media as immutable",
    directory => {
        expect(
            getDocumentationStaticCachePolicy(
                `/${directory}/example/image.0123456789abcdef.640w.webp`,
            ),
        ).toBe("ImmutableMedia");
    },
);

test("classifies stable authored blog media separately from hashed output", () => {
    expect(getDocumentationStaticCachePolicy("/blog/example/image.png")).toBe("StableMedia");
});

test("rejects unknown internal cache policy headers", () => {
    expect(() => parseDocumentationCachePolicy("private")).toThrow(
        "Unrecognized `DocumentationCachePolicy` type `private`",
    );
});
