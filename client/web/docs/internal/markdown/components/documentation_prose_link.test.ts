import {DocumentationProseLink} from "~/client/web/docs/internal/markdown/components/documentation_prose_link.js";

test("renders an external prose link", () => {
    expect(
        DocumentationProseLink.markdown({
            href: "https://alpine.inc",
            children: "Alpine",
        }),
    ).toBe("[Alpine](https://alpine.inc)");
});

test("rewrites internal links while preserving hash fragments", () => {
    expect(
        DocumentationProseLink.markdown({
            href: "/docs/guides/tasks#done",
            children: "Tasks",
        }),
    ).toBe("[Tasks](/docs/guides/tasks.md#done)");
});
