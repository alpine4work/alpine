import {json} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {loadGeneratedDocumentationApiHomePage} from "~/app/docs/load_generated_docs.server.js";
import {DocumentationApiReferenceView} from "~/client/web/docs/documentation_api_reference_view.js";
import {DocumentationMdxPage} from "~/client/web/docs/documentation_mdx_page.js";
import {DocumentationOnThisPage} from "~/client/web/docs/documentation_on_this_page.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {NotFoundError} from "~/shared/error/error.js";

export function meta() {
    return [
        {title: `Alpine API Reference${metaTitlePostfix}`},
        // TODO(#public-api): Remove this robots restriction when the public API is ready.
        {name: "robots", content: "noindex,nofollow"},
    ];
}

export async function loader() {
    const routeData = await loadGeneratedDocumentationApiHomePage();
    if (routeData === null) throw new NotFoundError("API page not found");

    return json(routeData);
}

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
