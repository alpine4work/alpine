import {Box} from "~/client/web/design/box.js";
import {documentationMdxComponents} from "~/client/web/docs/documentation_mdx_components.js";
import {getDocumentationMdxContent} from "~/client/web/docs/internal/get_documentation_mdx_content.js";
import {DocumentationMdxPageData} from "~/shared/docs/documentation_mdx_page_data.js";

export type {
    DocumentationApiPageData,
    DocumentationApiPageLink,
    DocumentationMdxPageData,
    GeneratedDocumentationPageData,
} from "~/shared/docs/documentation_mdx_page_data.js";

/**
 * One authored docs article: the frontmatter title + description, then the
 * compiled MDX body rendered with the shared documentation component mapping.
 */
export function DocumentationMdxPage({page}: {page: DocumentationMdxPageData}) {
    const Content = getDocumentationMdxContent(page.mdxCode);

    return (
        <Box as="article">
            <Box marginBottom="7">
                <Box as="h1" fontSize="700" fontStyle="extra-bold" color="grey-90" margin="0">
                    {page.title}
                </Box>
                {page.description !== null ? (
                    <Box fontSize="200" color="grey-50" marginTop="2" style={{lineHeight: 1.6}}>
                        {page.description}
                    </Box>
                ) : null}
            </Box>
            <Content components={documentationMdxComponents} />
        </Box>
    );
}
