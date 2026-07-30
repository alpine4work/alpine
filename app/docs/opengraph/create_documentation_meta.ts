import {getOpenGraphTitle} from "~/shared/content/open_graph_content.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

type DocumentationMetaPageBase = {
    type: "Blog" | "Documentation" | "APIReference";
    title: string;
    description?: string;
    pageUrl: string;
};

type DocumentationMetaBlogPostPage = DocumentationMetaPageBase & {
    type: "Blog";
    authorName: string;
    publishDate: string;
    modifiedDate: string;
    tags: Array<string>;
    twitterCreator: string | null;
};

export type DocumentationMetaPage =
    | (DocumentationMetaPageBase & {type: "Documentation" | "APIReference"})
    | (DocumentationMetaPageBase & {
          type: "Blog";
          authorName?: never;
          publishDate?: never;
          modifiedDate?: never;
          tags?: never;
          twitterCreator?: never;
      })
    | DocumentationMetaBlogPostPage;

export type DocumentationMetaDescriptor =
    | {title: string}
    | {name: string; content: string}
    | {property: string; content: string}
    | {tagName: "link"; rel: "canonical"; href: string};

/**
 * Create a loader-backed route meta function for public documentation content.
 */
export function createDocumentationMetaFunction<Data>(
    createPage: (data: Data) => DocumentationMetaPage,
): (args: {data: Data | undefined | Error}) => Array<DocumentationMetaDescriptor> {
    return ({data}) => {
        if (data === undefined || data instanceof Error) {
            return [{name: "robots", content: "noindex"}, {title: "Alpine"}];
        }

        return createDocumentationMeta(createPage(data));
    };
}

/**
 * Build complete route SEO, Open Graph, and Twitter metadata for public content.
 */
export function createDocumentationMeta(
    page: DocumentationMetaPage,
): Array<DocumentationMetaDescriptor> {
    const canonicalUrl = `https://alpine.inc${page.pageUrl}`;
    const imageUrl = `https://alpine.inc${page.pageUrl}/og.png`;
    const metaTitle = getOpenGraphTitle(page.title);
    const imageAlt = `${page.title} — Alpine`;
    const isBlogPost = isDocumentationMetaBlogPostPage(page);
    const isArticle = isDocumentationMetaArticlePage(page);
    const descriptors: Array<DocumentationMetaDescriptor> = [
        {title: metaTitle},
        {name: "application-name", content: "Alpine"},
        // TODO(#public-api): Remove this restriction when public content is ready to
        // index.
        {name: "robots", content: "noindex,nofollow"},
        {tagName: "link", rel: "canonical", href: canonicalUrl},
        {property: "og:type", content: isArticle ? "article" : "website"},
        {property: "og:site_name", content: "Alpine"},
        {property: "og:locale", content: "en_US"},
        {property: "og:title", content: metaTitle},
        {property: "og:url", content: canonicalUrl},
        {property: "og:image", content: imageUrl},
        {property: "og:image:secure_url", content: imageUrl},
        {property: "og:image:type", content: "image/png"},
        {property: "og:image:width", content: "1200"},
        {property: "og:image:height", content: "630"},
        {property: "og:image:alt", content: imageAlt},
        {name: "twitter:card", content: "summary_large_image"},
        {name: "twitter:site", content: "@alpine4work"},
        {name: "twitter:url", content: canonicalUrl},
        {name: "twitter:title", content: metaTitle},
        {name: "twitter:image", content: imageUrl},
        {name: "twitter:image:alt", content: imageAlt},
    ];

    if (page.description !== undefined && page.description.length > 0) {
        descriptors.push(
            {name: "description", content: page.description},
            {property: "og:description", content: page.description},
            {name: "twitter:description", content: page.description},
        );
    }

    if (isArticle) {
        descriptors.push({property: "article:section", content: articleSectionForPage(page)});
    }

    if (isBlogPost) {
        descriptors.push(
            {name: "author", content: page.authorName},
            {property: "article:author", content: page.authorName},
            {
                property: "article:published_time",
                content: `${page.publishDate}T00:00:00.000Z`,
            },
            {
                property: "article:modified_time",
                content: page.modifiedDate,
            },
            ...page.tags.map(tag => ({property: "article:tag" as const, content: tag})),
            ...(page.tags.length === 0
                ? []
                : [{name: "keywords" as const, content: page.tags.join(", ")}]),
            ...(page.twitterCreator === null
                ? []
                : [{name: "twitter:creator" as const, content: page.twitterCreator}]),
        );
    }

    return descriptors;
}

function articleSectionForPage(page: DocumentationMetaPage): string {
    switch (page.type) {
        case "Blog":
            return "Blog";
        case "Documentation":
            return "Documentation";
        case "APIReference":
            return "API Reference";
        default:
            throw exhaustive(page);
    }
}

function isDocumentationMetaArticlePage(page: DocumentationMetaPage): boolean {
    switch (page.type) {
        case "Blog":
            return isDocumentationMetaBlogPostPage(page);
        case "Documentation":
        case "APIReference":
            return true;
        default:
            throw exhaustive(page);
    }
}

function isDocumentationMetaBlogPostPage(
    page: DocumentationMetaPage,
): page is DocumentationMetaBlogPostPage {
    switch (page.type) {
        case "Blog":
            return page.authorName !== undefined;
        case "Documentation":
        case "APIReference":
            return false;
        default:
            throw exhaustive(page);
    }
}
