import {json} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {
    documentationRouteHeaders,
    getDocumentationResponseHeaders,
} from "~/app/docs/documentation_response_headers.server.js";
import {loadGeneratedDocumentationApiHomePage} from "~/app/docs/load_generated_docs.server.js";
import {createDocumentationMetaFunction} from "~/app/docs/opengraph/create_documentation_meta.js";
import {DocumentationApiReferenceView} from "~/client/web/docs/documentation_api_reference_view.js";
import {
    DocumentationApiPageData,
    DocumentationMdxPage,
} from "~/client/web/docs/documentation_mdx_page.js";
import {DocumentationOnThisPage} from "~/client/web/docs/documentation_on_this_page.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";

export const meta = createDocumentationMetaFunction<{page: DocumentationApiPageData}>(data => ({
    type: "APIReference",
    title: data.page.title,
    ...(data.page.description === null ? {} : {description: data.page.description}),
    pageUrl: data.page.url,
}));

/** Load the generated API reference landing page. */
export async function loader() {
    const routeData = await loadGeneratedDocumentationApiHomePage();
    if (routeData === null) throw new NotFoundError("API page not found");

    return json(routeData, {headers: getDocumentationResponseHeaders()});
}

export const headers = documentationRouteHeaders;

export default function DocumentationApiIndexRoute() {
    const {model, apiNav, page, searchIndex} = useLoaderData<typeof loader>();

    return (
        <DocumentationApiReferenceView
            model={model}
            apiNav={apiNav}
            searchIndex={searchIndex}
            active={{type: "page", slug: page.name}}
            rightRail={<DocumentationOnThisPage items={page.toc} />}
        >
            <DocumentationMdxPage page={page} />
        </DocumentationApiReferenceView>
    );
}
