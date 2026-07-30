import {Box} from "~/client/web/design/box.js";
import {DocumentationOnThisPageItem} from "~/client/web/docs/documentation_on_this_page.js";
import {getDocumentationMdxContent} from "~/client/web/docs/internal/get_documentation_mdx_content.js";
import {documentationMdxComponents} from "~/client/web/docs/internal/markdown/components/documentation_mdx_components.js";

export type DocumentationMdxPageData = {
    title: string;
    description: string | null;
    mdxCode: string;
};

export type GeneratedDocumentationPageData = DocumentationMdxPageData & {
    slug: string;
    toc: Array<DocumentationOnThisPageItem>;
};

/**
 * A sidebar link to one API "Get started" page (Introduction, Authentication, …),
 * derived from `content/api/`. The first page is the home page at `/docs/api`; the
 * rest live at `/docs/api/<name>`.
 */
export type DocumentationApiPageLink = {
    name: string;
    title: string;
    url: string;
    isHome: boolean;
};

/**
 * A loaded API "Get started" page: its link plus the compiled MDX body and toc.
 */
export type DocumentationApiPageData = DocumentationApiPageLink &
    DocumentationMdxPageData & {
        toc: Array<DocumentationOnThisPageItem>;
    };

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
