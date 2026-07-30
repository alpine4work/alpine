import {useEffect, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {sprinkles} from "~/client/web/styles/styles.js";

export type DocumentationOnThisPageItem = {
    id: string;
    text: string;
    level: 2 | 3;
};

type DocumentationOnThisPageSection = {
    item: DocumentationOnThisPageItem;
    children: Array<DocumentationOnThisPageItem>;
};

/**
 * The right-rail "On this page" table of contents. Items render on the server for
 * SSR; an `IntersectionObserver` scroll-spy activates the current heading once
 * hydrated. The active item is accent colored with a left accent bar.
 */
export function DocumentationOnThisPage({items}: {items: Array<DocumentationOnThisPageItem>}) {
    const [activeId, setActiveId] = useState<string | null>(null);
    const sections = groupDocumentationOnThisPageItems(items);

    useEffect(() => {
        const headings = items.flatMap(item => {
            const element = document.getElementById(item.id);
            return element === null ? [] : [element];
        });
        if (headings.length === 0) return;

        const observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    if (entry.isIntersecting) setActiveId(entry.target.id);
                }
            },
            {rootMargin: "-80px 0px -70% 0px", threshold: 0},
        );
        for (const heading of headings) observer.observe(heading);
        return () => observer.disconnect();
    }, [items]);

    if (items.length === 0) return null;

    return (
        <nav aria-label="On this page">
            <Box
                fontSize="25"
                fontStyle="bold"
                color="grey-40"
                marginBottom="3"
                style={{textTransform: "uppercase", letterSpacing: "0.04em"}}
            >
                On this page
            </Box>
            <Box display="flex" flexDirection="column" gap="1">
                {sections.map(section => (
                    <Box key={section.item.id} display="flex" flexDirection="column" gap="0.5">
                        <DocumentationOnThisPageLink item={section.item} activeId={activeId} />
                        {section.children.length > 0 ? (
                            <Box display="flex" flexDirection="column" gap="0.5" marginLeft="2.5">
                                {section.children.map(item => (
                                    <DocumentationOnThisPageLink
                                        key={item.id}
                                        item={item}
                                        activeId={activeId}
                                    />
                                ))}
                            </Box>
                        ) : null}
                    </Box>
                ))}
            </Box>
        </nav>
    );
}

function DocumentationOnThisPageLink({
    item,
    activeId,
}: {
    item: DocumentationOnThisPageItem;
    activeId: string | null;
}) {
    const active = item.id === activeId;

    return (
        <a
            href={`#${item.id}`}
            onClick={event => {
                event.preventDefault();
                const element = document.getElementById(item.id);
                if (element === null) return;
                const top = element.getBoundingClientRect().top + window.scrollY - 88;
                window.scrollTo({top, behavior: "smooth"});
            }}
            className={sprinkles({
                fontSize: "75",
                fontStyle: active ? "semi-bold" : "normal",
                color: active ? "theme-50" : "grey-50",
                paddingY: "1",
                borderLeft: active ? "theme-50" : "transparent",
                borderLeftWidth: "thick",
                paddingLeft: "2.5",
            })}
            style={{textDecoration: "none", lineHeight: 1.4}}
        >
            {item.text}
        </a>
    );
}

function groupDocumentationOnThisPageItems(
    items: Array<DocumentationOnThisPageItem>,
): Array<DocumentationOnThisPageSection> {
    const sections: Array<DocumentationOnThisPageSection> = [];

    for (const item of items) {
        const section = sections[sections.length - 1];
        if (item.level === 2 || section === undefined) {
            sections.push({item, children: []});
        } else {
            section.children.push(item);
        }
    }

    return sections;
}
