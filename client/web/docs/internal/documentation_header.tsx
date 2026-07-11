import {List} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {documentationApiHomeUrl} from "~/client/web/docs/documentation_api_home_url.js";
import {documentationHomeUrl} from "~/client/web/docs/documentation_home_url.js";
import {DocumentationLink} from "~/client/web/docs/internal/documentation_link.js";
import {DocumentationSearch} from "~/client/web/docs/internal/documentation_search.js";
import {DocumentationUnstyledButton} from "~/client/web/docs/internal/documentation_unstyled_button.js";
import {DocumentationSearchIndex} from "~/client/web/docs/search_documentation_entries.js";
import {LogoMark} from "~/client/web/icons/brand/logo_mark.js";

export type DocumentationSurface = "guides" | "api";

/**
 * The sticky docs header: Alpine logo + wordmark + "docs" tag, the Guides / API
 * Reference tabs (active tab gets a 2px accent underline), a search stub, and the
 * color scheme toggle.
 */
export function DocumentationHeader({
    surface,
    searchIndex,
    onOpenDrawer,
}: {
    surface: DocumentationSurface;
    searchIndex: DocumentationSearchIndex;
    onOpenDrawer: () => void;
}) {
    return (
        <Box
            as="header"
            position="sticky"
            top="0"
            zIndex="50"
            borderBottom="grey-5"
            backgroundColor="grey-0-opacity-80"
            style={{backdropFilter: "saturate(1.4) blur(8px)"}}
        >
            <Box
                display="flex"
                alignItems="center"
                gap="5"
                height="14"
                paddingX="5"
                marginX="center"
                style={{maxWidth: 1440}}
            >
                <DocumentationUnstyledButton
                    ariaLabel="Open navigation"
                    onClick={onOpenDrawer}
                    className="documentationDrawerButton"
                    box={{
                        alignItems: "center",
                        justifyContent: "center",
                        border: "none",
                        backgroundColor: "transparent",
                        color: "grey-50",
                        cursor: "pointer",
                        padding: "1",
                    }}
                >
                    <List size={20} />
                </DocumentationUnstyledButton>

                <DocumentationLink
                    url={documentationHomeUrl}
                    box={{display: "flex", alignItems: "center", gap: "2"}}
                >
                    <LogoMark size="5" color="grey-90" />
                    <Box as="span" fontSize="200" fontStyle="extra-bold" color="grey-90">
                        Alpine
                    </Box>
                    <Box as="span" fontSize="50" fontStyle="semi-bold" color="grey-40">
                        docs
                    </Box>
                </DocumentationLink>

                <Box as="nav" display="flex" alignItems="stretch" gap="5" height="full">
                    <DocumentationHeaderTab
                        url={documentationHomeUrl}
                        active={surface === "guides"}
                    >
                        Guides
                    </DocumentationHeaderTab>
                    <DocumentationHeaderTab
                        url={documentationApiHomeUrl}
                        active={surface === "api"}
                    >
                        API Reference
                    </DocumentationHeaderTab>
                </Box>

                <Box flex="1" />

                <DocumentationSearch searchIndex={searchIndex} />
            </Box>
        </Box>
    );
}

function DocumentationHeaderTab({
    url,
    active,
    children,
}: {
    url: string;
    active: boolean;
    children: string;
}) {
    return (
        <DocumentationLink
            url={url}
            ariaCurrent={active ? "page" : undefined}
            box={{
                display: "flex",
                alignItems: "center",
                fontSize: "100",
                fontStyle: active ? "semi-bold" : "normal",
                color: active ? "grey-90" : "grey-50",
                borderBottom: active ? "theme-50" : "transparent",
                borderBottomWidth: "thick",
            }}
            style={{marginBottom: -1}}
        >
            {children}
        </DocumentationLink>
    );
}
