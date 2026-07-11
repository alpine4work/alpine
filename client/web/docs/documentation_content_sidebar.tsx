import {useEffect, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {
    DocumentationNavGroup,
    DocumentationNavNode,
    createDocumentationDocUrl,
    documentationGroupContainsSlug,
} from "~/client/web/docs/documentation_nav.js";
import {DocumentationChevron} from "~/client/web/docs/internal/documentation_chevron.js";
import {DocumentationNavRow} from "~/client/web/docs/internal/documentation_nav_row.js";
import {DocumentationUnstyledButton} from "~/client/web/docs/internal/documentation_unstyled_button.js";

/**
 * The docs content sidebar, rendered from the directory-driven navigation tree.
 * Documentation are navigation rows; directories are collapsible groups (default
 * open, force-open when they contain the active page), nested arbitrarily deep
 * behind hairline left rails.
 */
export function DocumentationContentSidebar({
    nodes,
    activeSlug,
}: {
    nodes: Array<DocumentationNavNode>;
    activeSlug: string;
}) {
    return (
        <Box display="flex" flexDirection="column" gap="0.5">
            {nodes.map(node => (
                <DocumentationNavTreeNode key={node.slug} node={node} activeSlug={activeSlug} />
            ))}
        </Box>
    );
}

function DocumentationNavTreeNode({
    node,
    activeSlug,
}: {
    node: DocumentationNavNode;
    activeSlug: string;
}) {
    if (node.type === "doc") {
        return (
            <DocumentationNavRow
                url={createDocumentationDocUrl(node.slug)}
                active={node.slug === activeSlug}
            >
                {node.title}
            </DocumentationNavRow>
        );
    }
    return <DocumentationNavTreeGroup group={node} activeSlug={activeSlug} />;
}

function DocumentationNavTreeGroup({
    group,
    activeSlug,
}: {
    group: DocumentationNavGroup;
    activeSlug: string;
}) {
    const containsActive = documentationGroupContainsSlug(group, activeSlug);
    const [open, setOpen] = useState(true);

    useEffect(() => {
        if (containsActive) setOpen(true);
    }, [containsActive]);

    return (
        <Box>
            <DocumentationUnstyledButton
                ariaExpanded={open}
                onClick={() => setOpen(!open)}
                box={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1.5",
                    width: "full",
                    border: "none",
                    backgroundColor: "transparent",
                    cursor: "pointer",
                    paddingX: "2.5",
                    paddingY: "1.5",
                    borderRadius: "2",
                    color: "grey-90",
                    fontSize: "75",
                    fontStyle: "semi-bold",
                    textAlign: "left",
                }}
            >
                <DocumentationChevron open={open} />
                <Box as="span" flex="1" minWidth="flex-fit">
                    {group.title}
                </Box>
            </DocumentationUnstyledButton>
            {open ? (
                <Box
                    display="flex"
                    flexDirection="column"
                    gap="0.5"
                    marginLeft="2"
                    paddingLeft="1.5"
                    borderLeft="grey-5"
                >
                    {group.children.map(child => (
                        <DocumentationNavTreeNode
                            key={child.slug}
                            node={child}
                            activeSlug={activeSlug}
                        />
                    ))}
                </Box>
            ) : null}
        </Box>
    );
}
