import {ReactNode} from "react";
import {useHover} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {DocumentationLink} from "~/client/web/docs/internal/documentation_link.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/shared/docs/documentation_markdown_component.js";
import {toDocumentationMarkdownLinkUrl} from "~/shared/docs/to_documentation_markdown_link_url.js";

/**
 * One card in a `<CardGrid>`. Hover lifts the border from hairline to strong. In
 * markdown it becomes a single list item linking to its target.
 */
export const DocumentationCard = documentationComponent({
    react: function DocumentationCardView({
        title,
        url,
        children,
    }: {
        title: string;
        url: string;
        children?: ReactNode;
    }) {
        const {hoverProps, isHovered} = useHover({});
        return (
            <div {...hoverProps} style={{display: "grid"}}>
                <DocumentationLink
                    url={url}
                    box={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "1.5",
                        padding: "4",
                        borderRadius: "2",
                        border: isHovered ? "grey-10" : "grey-5",
                        backgroundColor: "grey-0",
                        boxShadow: "elevation-5-without-border",
                    }}
                    style={{transition: "border-color 0.15s ease"}}
                >
                    <Box
                        display="flex"
                        alignItems="center"
                        gap="2"
                        fontSize="100"
                        fontStyle="semi-bold"
                        color="grey-90"
                    >
                        <Box as="span" flex="1" minWidth="flex-fit">
                            {title}
                        </Box>
                        <Box as="span" color={isHovered ? "theme-50" : "grey-40"}>
                            →
                        </Box>
                    </Box>
                    {children !== undefined ? (
                        <Box fontSize="75" color="grey-50" style={{lineHeight: 1.5}}>
                            {children}
                        </Box>
                    ) : null}
                </DocumentationLink>
            </div>
        );
    },
    markdown: props => {
        const title = typeof props.title === "string" ? props.title : "";
        const url = typeof props.url === "string" ? props.url : "";
        const description = flattenDocumentationMarkdownChildren(props.children).trim();
        return `- [${title}](${toDocumentationMarkdownLinkUrl(url)})${description.length > 0 ? `: ${description}` : ""}`;
    },
});
