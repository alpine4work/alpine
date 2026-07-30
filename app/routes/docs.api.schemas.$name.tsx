import {json} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {loadGeneratedDocumentationApiSchemaRouteData} from "~/app/docs/load_generated_docs.server.js";
import {DocumentationApiReferenceView} from "~/client/web/docs/documentation_api_reference_view.js";
import {DocumentationApiSchemaPage} from "~/client/web/docs/documentation_api_schema_page.js";
import {DocumentationOnThisPage} from "~/client/web/docs/documentation_on_this_page.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";

export function meta() {
    return [
        {title: `Alpine API Reference${metaTitlePostfix}`},
        // TODO(#public-api): Remove this robots restriction when the public API is ready.
        {name: "robots", content: "noindex,nofollow"},
    ];
}

export async function loader({params}: LoaderArgs) {
    const name = params.name ?? "";
    const routeData = await loadGeneratedDocumentationApiSchemaRouteData(name);
    if (routeData === null) throw notFoundResponse();
    return json({...routeData, name});
}

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
