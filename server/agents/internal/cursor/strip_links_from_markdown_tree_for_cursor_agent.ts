import {Link, Parent, Root} from "mdast";

export function stripLinksFromMarkdownTreeForCursorAgent(
    root: Root,
    {shouldKeepLink}: {shouldKeepLink: (link: Link) => boolean},
) {
    const traverse = (node: Parent) => {
        let index = 0;

        while (index < node.children.length) {
            const child = node.children[index]!;

            if (
                (child.type === "link" && !shouldKeepLink(child)) ||
                child.type === "linkReference"
            ) {
                node.children.splice(index, 1, ...child.children);

                // If we're stripping an account link, add an `@` prefix to the text to communicate
                // the text is a mention which is important context. Importantly, we want cursor
                // mentions to be presented as `@Cursor`.
                if (child.type === "link" && child.url.startsWith("/account/")) {
                    node.children.splice(index, 0, {type: "text", value: "@"});
                }

                // Intentionally don't increment `index` here. The next turn of the while loop
                // should see the link children we just inlined.
            } else {
                if ("children" in child) traverse(child);
                index++;
            }
        }
    };

    traverse(root);
}
