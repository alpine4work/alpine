import {handleDocumentationOpenGraphImageRoute} from "~/app/docs/handle_documentation_open_graph_image_route.js";

test("matches a nested Open Graph image through its internal resource URL", () => {
    const matches = [{id: "routes/og.$"}];

    expect(
        handleDocumentationOpenGraphImageRoute(
            new URL("https://alpine.inc/blog/designing-the-work-graph/og.png"),
            url => (url.pathname === "/og/blog/designing-the-work-graph.png" ? matches : null),
        ),
    ).toEqual([
        "/blog/*/og.png",
        {
            matches,
            route: "/blog/*/og.png",
            url: new URL("https://alpine.inc/og/blog/designing-the-work-graph.png"),
        },
    ]);
});

test("ignores requests that are not nested Open Graph images", () => {
    expect(
        handleDocumentationOpenGraphImageRoute(new URL("https://alpine.inc/docs/guides"), () => []),
    ).toBe(null);
});
