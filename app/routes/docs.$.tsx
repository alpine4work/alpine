import {json} from "@remix-run/node";
import {useLoaderData, useParams} from "@remix-run/react";
import {
    documentationRouteHeaders,
    getDocumentationResponseHeaders,
} from "~/app/docs/documentation_response_headers.server.js";
import {loadGeneratedDocumentationPage} from "~/app/docs/load_generated_docs.server.js";
import {createDocumentationMetaFunction} from "~/app/docs/opengraph/create_documentation_meta.js";
import {DocumentationContentSidebar} from "~/client/web/docs/documentation_content_sidebar.js";
import {
    DocumentationMdxPage,
    GeneratedDocumentationPageData,
} from "~/client/web/docs/documentation_mdx_page.js";
import {createDocumentationDocUrl} from "~/client/web/docs/documentation_nav.js";
import {DocumentationOnThisPage} from "~/client/web/docs/documentation_on_this_page.js";
import {DocumentationPageLayout} from "~/client/web/docs/documentation_page_layout.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";

export const meta = createDocumentationMetaFunction<{page: GeneratedDocumentationPageData}>(
    data => ({
        type: "Documentation",
        title: data.page.title,
        ...(data.page.description === null ? {} : {description: data.page.description}),
        pageUrl: createDocumentationDocUrl(data.page.slug),
    }),
);

/** Load a generated guide page with the shared documentation cache policy. */
export async function loader({params}: LoaderArgs) {
    const slug = params["*"] ?? "";
    const routeData = await loadGeneratedDocumentationPage(slug);
    if (routeData === null) {
        throw notFoundResponse();
    }

    return json(routeData, {headers: getDocumentationResponseHeaders()});
}

export const headers = documentationRouteHeaders;

export default function DocumentationContentRoute() {
    const {navTree, page, searchIndex} = useLoaderData<typeof loader>();
    const params = useParams();
    const activeSlug = params["*"] ?? "";

    return (
        <DocumentationPageLayout
            surface="guides"
            searchIndex={searchIndex}
            contentWidth="prose"
            sidebar={<DocumentationContentSidebar nodes={navTree.nodes} activeSlug={activeSlug} />}
            rightRail={<DocumentationOnThisPage items={page.toc} />}
        >
            <DocumentationMdxPage page={page} />
        </DocumentationPageLayout>
    );
}
