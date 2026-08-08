import {ReactNode} from "react";
import {DocumentationPageLayout} from "~/client/web/docs/documentation_page_layout.js";
import {DocumentationApiModelProvider} from "~/client/web/docs/internal/documentation_api_context.js";
import {
    DocumentationApiSidebar,
    DocumentationApiSidebarActive,
} from "~/client/web/docs/internal/documentation_api_sidebar.js";
import {DocumentationApiModel} from "~/shared/docs/documentation_api_model.js";
import {GeneratedDocumentationApiNav} from "~/shared/docs/generated_documentation.js";
import {DocumentationSearchIndex} from "~/shared/docs/search_documentation_entries.js";

/**
 * The shared assembly for every API reference route: the docs shell with the API
 * sidebar, using generated API data for page links, endpoint groups, and schema
 * names. Page bodies render live React components from generated model/MDX data.
 */
export function DocumentationApiReferenceView({
    model,
    apiNav,
    searchIndex,
    active,
    rightRail,
    rightRailBorder = false,
    children,
}: {
    model: DocumentationApiModel;
    apiNav: GeneratedDocumentationApiNav;
    searchIndex: DocumentationSearchIndex;
    active: DocumentationApiSidebarActive;
    rightRail: ReactNode;
    rightRailBorder?: boolean;
    children: ReactNode;
}) {
    return (
        <DocumentationApiModelProvider model={model}>
            <DocumentationPageLayout
                surface="api"
                searchIndex={searchIndex}
                contentWidth="reference"
                sidebar={<DocumentationApiSidebar apiNav={apiNav} active={active} />}
                rightRail={rightRail}
                rightRailBorder={rightRailBorder}
            >
                {children}
            </DocumentationPageLayout>
        </DocumentationApiModelProvider>
    );
}
