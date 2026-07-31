/* eslint-disable react-refresh/only-export-components -- co-located markdown variants (plain functions) live beside these components. */
import {ReactNode} from "react";
import {useHover} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    DocumentationMarkdownChildren,
    flattenDocumentationMarkdownChildren,
} from "~/shared/docs/documentation_markdown_component.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * A page heading with a stable anchor id. Hovering reveals a `#` link so readers
 * can copy deep links. The id doubles as the scroll target for the "On this page"
 * rail (with scroll margin clearing the sticky header).
 */
export function DocumentationAnchorHeading({
    level,
    id,
    children,
}: {
    level: 1 | 2 | 3;
    id: string;
    children: ReactNode;
}) {
    const {hoverProps, isHovered} = useHover({});

    let heading;
    switch (level) {
        case 1:
            heading = {as: "h1", fontSize: "700", fontStyle: "extra-bold"} as const;
            break;
        case 2:
            heading = {as: "h2", fontSize: "400", fontStyle: "bold"} as const;
            break;
        case 3:
            heading = {as: "h3", fontSize: "200", fontStyle: "bold"} as const;
            break;
        default:
            throw exhaustive(level);
    }

    return (
        <Box
            {...hoverProps}
            as={heading.as}
            id={id}
            fontSize={heading.fontSize}
            fontStyle={heading.fontStyle}
            color="grey-90"
            position="relative"
            marginTop={level === 1 ? "0" : level === 2 ? "10" : "6"}
            marginBottom={level === 1 ? "1.5" : level === 2 ? "3" : "2.5"}
            marginX="0"
            style={{scrollMarginTop: 88}}
        >
            {children}
            <a
                href={`#${id}`}
                aria-label="Link to this heading"
                className={sprinkles({
                    color: "theme-50",
                    paddingLeft: "2",
                    position: "absolute",
                    fontStyle: "normal",
                    opacity: isHovered ? "60" : "0",
                })}
                style={{textDecoration: "none", transition: "opacity 0.15s ease"}}
            >
                #
            </a>
        </Box>
    );
}

/** Renders a heading as `#` repeated `level` times followed by its text. */
export function documentationHeadingToMarkdown(
    level: number,
    children: DocumentationMarkdownChildren,
): string {
    return `${"#".repeat(level)} ${flattenDocumentationMarkdownChildren(children).trim()}\n\n`;
}
