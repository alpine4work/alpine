import {json} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {
    documentationRouteHeaders,
    getDocumentationResponseHeaders,
} from "~/app/docs/documentation_response_headers.server.js";
import {loadGeneratedDocumentationApiSchemaRouteData} from "~/app/docs/load_generated_docs.server.js";
import {createDocumentationMetaFunction} from "~/app/docs/opengraph/create_documentation_meta.js";
import {
    DocumentationApiModel,
    createDocumentationApiSchemaUrl,
    getDocumentationApiSchemaBaseName,
} from "~/client/web/docs/documentation_api_model.js";
import {DocumentationApiReferenceView} from "~/client/web/docs/documentation_api_reference_view.js";
import {DocumentationApiSchemaPage} from "~/client/web/docs/documentation_api_schema_page.js";
import {DocumentationOnThisPage} from "~/client/web/docs/documentation_on_this_page.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/** Build metadata for a generated API schema reference page. */
export const meta = createDocumentationMetaFunction<{
    name: string;
    model: DocumentationApiModel;
}>(data => {
    const description = assertExists(data.model.schemas[data.name]).description;
    return {
        type: "APIReference",
        title: `${getDocumentationApiSchemaBaseName(data.name)} schema`,
        ...(description === undefined ? {} : {description}),
        pageUrl: createDocumentationApiSchemaUrl(data.name),
    };
});

/** Load generated API schema data by its public reference name. */
export async function loader({params}: LoaderArgs) {
    const name = params.name ?? "";
    const routeData = await loadGeneratedDocumentationApiSchemaRouteData(name);
    if (routeData === null) throw notFoundResponse();
    return json({...routeData, name}, {headers: getDocumentationResponseHeaders()});
}

export const headers = documentationRouteHeaders;

export default function DocumentationApiSchemaRoute() {
    const {model, apiNav, name, searchIndex} = useLoaderData<typeof loader>();
    const hasBacklinks = (model.backlinksBySchemaName[name] ?? []).length > 0;

    return (
        <DocumentationApiReferenceView
            model={model}
            apiNav={apiNav}
            searchIndex={searchIndex}
            active={{type: "schema", name}}
            rightRail={
                <DocumentationOnThisPage
                    items={[
                        {id: "properties", text: "Properties", level: 2},
                        ...(hasBacklinks
                            ? [{id: "referenced-by", text: "Referenced by", level: 2 as const}]
                            : []),
                    ]}
                />
            }
        >
            <DocumentationApiSchemaPage name={name} />
        </DocumentationApiReferenceView>
    );
}
