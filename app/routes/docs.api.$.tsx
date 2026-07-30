import {json, redirect} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {
    loadGeneratedDocumentationApiMdxPage,
    loadGeneratedDocumentationApiOperationRouteData,
} from "~/app/docs/load_generated_docs.server.js";
import {createDocumentationMetaFunction} from "~/app/docs/opengraph/create_documentation_meta.js";
import {buildDocumentationApiCodeSamples} from "~/client/web/docs/build_api_documentation_code_samples.js";
import {createDocumentationApiPageUrl} from "~/client/web/docs/create_documentation_api_page_url.js";
import {DocumentationApiEndpointPage} from "~/client/web/docs/documentation_api_endpoint_page.js";
import {
    DocumentationApiOperation,
    createDocumentationApiOperationUrl,
} from "~/client/web/docs/documentation_api_model.js";
import {DocumentationApiReferenceView} from "~/client/web/docs/documentation_api_reference_view.js";
import {
    DocumentationApiPageData,
    DocumentationMdxPage,
} from "~/client/web/docs/documentation_mdx_page.js";
import {
    DocumentationOnThisPage,
    DocumentationOnThisPageItem,
} from "~/client/web/docs/documentation_on_this_page.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";

type DocumentationApiRouteMetaData =
    | {type: "operation"; operation: DocumentationApiOperation}
    | {type: "page"; page: DocumentationApiPageData};

export const meta = createDocumentationMetaFunction<DocumentationApiRouteMetaData>(data => {
    if (data.type === "operation") {
        return {
            type: "APIReference",
            title: data.operation.title,
            ...(data.operation.description === null
                ? {}
                : {description: data.operation.description}),
            pageUrl: createDocumentationApiOperationUrl(data.operation.slug),
        };
    }
    return {
        type: "APIReference",
        title: data.page.title,
        ...(data.page.description === null ? {} : {description: data.page.description}),
        pageUrl: data.page.url,
    };
});

export async function loader({params}: LoaderArgs) {
    // The more specific `docs.api.schemas.$name` route wins for schema pages. This
    // splat serves both authored API pages and generated operation pages.
    const slug = params["*"] ?? "";
    const operationRouteData = await loadGeneratedDocumentationApiOperationRouteData(slug);
    if (operationRouteData !== null) {
        return json({
            type: "operation" as const,
            ...operationRouteData,
            samples: buildDocumentationApiCodeSamples(
                operationRouteData.model,
                operationRouteData.operation,
            ),
        });
    }
    const canonicalOperationSlug = slug.replaceAll(/[{}]/g, "");
    if (canonicalOperationSlug !== slug) {
        const canonicalOperationRouteData =
            await loadGeneratedDocumentationApiOperationRouteData(canonicalOperationSlug);
        if (canonicalOperationRouteData !== null) {
            return redirect(createDocumentationApiOperationUrl(canonicalOperationSlug));
        }
    }

    const pageRouteData = await loadGeneratedDocumentationApiMdxPage(
        createDocumentationApiPageUrl(slug),
    );
    if (pageRouteData !== null) return json({type: "page" as const, ...pageRouteData});

    throw notFoundResponse();
}

function documentationApiEndpointToc({
    operation,
    hasResponseExample,
}: {
    operation: DocumentationApiOperation;
    hasResponseExample: boolean;
}): Array<DocumentationOnThisPageItem> {
    return [
        {id: "request", text: "Request", level: 2 as const},
        ...(operation.pathParameters.length > 0
            ? [{id: "path-parameters", text: "Path parameters", level: 3 as const}]
            : []),
        ...(operation.queryParameters.length > 0
            ? [{id: "query-parameters", text: "Query parameters", level: 3 as const}]
            : []),
        ...(operation.requestBody?.schema != null
            ? [{id: "request-body", text: "Request body", level: 3 as const}]
            : []),
        {id: "request-example", text: "Request example", level: 3 as const},
        ...(operation.response?.schema != null || hasResponseExample
            ? [{id: "response", text: "Response", level: 2 as const}]
            : []),
        ...(operation.response?.schema != null
            ? [{id: "response-body", text: "Response body", level: 3 as const}]
            : []),
        ...(hasResponseExample
            ? [{id: "response-example", text: "Response example", level: 3 as const}]
            : []),
        {id: "errors", text: "Errors", level: 2 as const},
    ];
}

export default function DocumentationApiPageRoute() {
    const routeData = useLoaderData<typeof loader>();

    if (routeData.type === "operation") {
        return (
            <DocumentationApiReferenceView
                model={routeData.model}
                apiNav={routeData.apiNav}
                searchIndex={routeData.searchIndex}
                active={{type: "operation", slug: routeData.operation.slug}}
                rightRail={
                    <DocumentationOnThisPage
                        items={documentationApiEndpointToc({
                            operation: routeData.operation,
                            hasResponseExample: routeData.samples.response !== null,
                        })}
                    />
                }
            >
                <DocumentationApiEndpointPage
                    operation={routeData.operation}
                    samples={routeData.samples}
                />
            </DocumentationApiReferenceView>
        );
    }

    return (
        <DocumentationApiReferenceView
            model={routeData.model}
            apiNav={routeData.apiNav}
            searchIndex={routeData.searchIndex}
            active={{type: "page", slug: routeData.page.name}}
            rightRail={<DocumentationOnThisPage items={routeData.page.toc} />}
        >
            <DocumentationMdxPage page={routeData.page} />
        </DocumentationApiReferenceView>
    );
}
