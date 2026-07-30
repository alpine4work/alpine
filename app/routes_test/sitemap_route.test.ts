import {loader} from "~/app/routes/sitemap[.]xml.js";

test("serves Alpine\u2019s committed sitemap without repository metadata", async () => {
    const response = await loader();
    const sitemap = await response.text();
    const locations = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), match => match[1]);

    expect({
        cacheControl: response.headers.get("cache-control"),
        cachePolicy: response.headers.get("cyberworlds-documentation-cache-policy"),
        contentType: response.headers.get("content-type"),
        hasGeneratedComment: sitemap.includes("@generated"),
        locations,
    }).toEqual({
        cacheControl: "public, max-age=300, stale-while-revalidate=86400, stale-if-error=604800",
        cachePolicy: "GeneratedMetadata",
        contentType: "application/xml; charset=utf-8",
        hasGeneratedComment: false,
        locations: [
            "https://alpine.inc/",
            "https://alpine.inc/auth/sign-in",
            "https://alpine.inc/auth/sign-up",
        ],
    });
});
