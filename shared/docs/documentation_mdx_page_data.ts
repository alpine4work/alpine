import {DocumentationOnThisPageItem} from "~/shared/docs/documentation_on_this_page_item.js";

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
 * derived from authored API content. The first page is the home page at
 * `/docs/api`; the rest live at `/docs/api/<name>`.
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
