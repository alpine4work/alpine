import {DocumentationCard} from "~/client/web/docs/internal/markdown/components/documentation_card.js";

test("renders a link card with description", () => {
    expect(
        DocumentationCard.markdown({
            title: "Tasks",
            url: "/docs/tasks",
            children: "Manage work.",
        }),
    ).toBe("- [Tasks](/docs/tasks.md): Manage work.");
});

test("does not rewrite markdown URLs and trims description text", () => {
    expect(
        DocumentationCard.markdown({
            title: "Tasks",
            url: "/docs/guides/tasks.md",
            children: "  Manage task lists.  ",
        }),
    ).toBe("- [Tasks](/docs/guides/tasks.md): Manage task lists.");
});
