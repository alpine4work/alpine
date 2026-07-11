import {json} from "@remix-run/node";
import {useLoaderData, useParams} from "@remix-run/react";
import {loadGeneratedDocumentationPage} from "~/app/docs/load_generated_docs.server.js";
import {DocumentationContentSidebar} from "~/client/web/docs/documentation_content_sidebar.js";
import {DocumentationMdxPage} from "~/client/web/docs/documentation_mdx_page.js";
import {DocumentationOnThisPage} from "~/client/web/docs/documentation_on_this_page.js";
import {DocumentationPageLayout} from "~/client/web/docs/documentation_page_layout.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";

export function meta() {
    return [
        {title: `Alpine Documentation${metaTitlePostfix}`},
        // TODO(#public-api): Remove this robots restriction when the public API is ready.
        {name: "robots", content: "noindex,nofollow"},
    ];
}

export async function loader({params}: LoaderArgs) {
    const slug = params["*"] ?? "";
    const routeData = await loadGeneratedDocumentationPage(slug);
    if (routeData === null) {
        throw notFoundResponse();
    }

    return json(routeData);
}

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
