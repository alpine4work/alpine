import {getDocumentationOpenGraphImageRoute} from "~/app/docs/get_documentation_open_graph_image_route.js";

test("maps a nested documentation Open Graph image to the internal resource route", () => {
    expect(
        getDocumentationOpenGraphImageRoute(
            new URL("https://alpine.inc/docs/guides/documents/og.png"),
        ),
    ).toEqual({
        route: "/docs/*/og.png",
        url: new URL("https://alpine.inc/og/docs/guides/documents.png"),
    });
});

test("uses one bounded route label for different documentation paths", () => {
    expect(
        ["/docs/guides/documents/og.png", "/docs/api/schemas/ContentDocument/og.png"].map(
            path =>
                getDocumentationOpenGraphImageRoute(new URL(`https://alpine.inc${path}`))?.route,
        ),
    ).toEqual(["/docs/*/og.png", "/docs/*/og.png"]);
});

test("ignores Open Graph image paths outside documentation and blog pages", () => {
    expect(getDocumentationOpenGraphImageRoute(new URL("https://alpine.inc/inbox/og.png"))).toBe(
        null,
    );
});
