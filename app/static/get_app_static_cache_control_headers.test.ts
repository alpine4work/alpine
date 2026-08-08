import {getAppStaticCacheControlHeaders} from "~/app/static/get_app_static_cache_control_headers.js";

test.each(["api", "blog", "docs"])(
    "caches fingerprinted %s documentation images immutably",
    directory => {
        expect(
            getAppStaticCacheControlHeaders(
                `/${directory}/example/_responsive/image.png/image.0123456789abcdef.640w.webp`,
            ),
        ).toEqual({
            clientCacheControl: "public, max-age=31536000, immutable",
            edgeCacheControl: "public, max-age=31536000, immutable",
        });
    },
);

test("caches fingerprinted original documentation images immutably", () => {
    expect(
        getAppStaticCacheControlHeaders(
            "/blog/example/_responsive/image.png/image.0123456789abcdef.png",
        ),
    ).toEqual({
        clientCacheControl: "public, max-age=31536000, immutable",
        edgeCacheControl: "public, max-age=31536000, immutable",
    });
});

test("gives stable blog media a finite edge TTL", () => {
    expect(getAppStaticCacheControlHeaders("/blog/example/image.png")).toEqual({
        clientCacheControl: "public, max-age=86400, stale-while-revalidate=604800",
        edgeCacheControl: "public, max-age=604800",
    });
});

test("gives stable docs Open Graph media the same policy as blog media", () => {
    expect(getAppStaticCacheControlHeaders("/docs/example/og.png")).toEqual({
        clientCacheControl: "public, max-age=86400, stale-while-revalidate=604800",
        edgeCacheControl: "public, max-age=604800",
    });
});

test("gives other static files the default cache policy", () => {
    expect(getAppStaticCacheControlHeaders("/favicon.ico")).toEqual({
        clientCacheControl: "public, max-age=86400, stale-while-revalidate=31536000",
        edgeCacheControl: "public, max-age=86400",
    });
});
