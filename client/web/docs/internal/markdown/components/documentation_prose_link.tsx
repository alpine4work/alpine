import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {DocumentationLink} from "~/client/web/docs/internal/documentation_link.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/shared/docs/documentation_markdown_component.js";
import {documentationMarkdownStringProp} from "~/shared/docs/documentation_markdown_string_prop.js";
import {toDocumentationMarkdownLinkUrl} from "~/shared/docs/to_documentation_markdown_link_url.js";

/**
 * An inline link in prose. Internal links (starting with `/`) route client-side;
 * external links open in a new tab. In markdown both become `[text](url)`.
 */
export const DocumentationProseLink = documentationComponent({
    react: ({href, children}: {href?: string; children?: ReactNode}) => {
        const target = href ?? "";
        if (target.startsWith("/")) {
            return (
                <DocumentationLink
                    url={target}
                    box={{color: "theme-50", fontStyle: "semi-bold"}}
                    style={{display: "inline"}}
                >
                    {children}
                </DocumentationLink>
            );
        }
        return (
            <Box as="span" color="theme-50" fontStyle="semi-bold" style={{display: "inline"}}>
                <a
                    href={target}
                    target="_blank"
                    rel="noreferrer"
                    style={{color: "inherit", textDecoration: "none"}}
                >
                    {children}
                </a>
            </Box>
        );
    },
    markdown: props =>
        `[${flattenDocumentationMarkdownChildren(props.children)}](${toDocumentationMarkdownLinkUrl(
            documentationMarkdownStringProp(props, "href"),
        )})`,
});
