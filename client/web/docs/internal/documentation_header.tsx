import {useNavigate} from "@remix-run/react";
import {List} from "phosphor-react";
import {ReactNode, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationApiHomeUrl} from "~/client/web/docs/documentation_api_home_url.js";
import {documentationHomeUrl} from "~/client/web/docs/documentation_home_url.js";
import {blogHomeUrl} from "~/client/web/docs/internal/blog_home_url.js";
import {DocumentationLink} from "~/client/web/docs/internal/documentation_link.js";
import {DocumentationSearch} from "~/client/web/docs/internal/documentation_search.js";
import {DocumentationUnstyledButton} from "~/client/web/docs/internal/documentation_unstyled_button.js";
import {DocumentationSearchIndex} from "~/client/web/docs/search_documentation_entries.js";
import {LogoMark} from "~/client/web/icons/brand/logo_mark.js";

export type DocumentationSurface = "guides" | "api" | "blog";

const documentationHeaderCss = `
.documentationDrawerButton { display: none; }
.documentationHeaderTabs { display: flex; }
.documentationSearchStub { display: flex; }
@media (max-width: 860px) {
    .documentationDrawerButton { display: inline-flex; }
    .documentationHeaderHomeLink {
        left: 50%;
        position: absolute;
        transform: translateX(-50%);
    }
    .documentationHeaderTabs { display: none; }
    .documentationSearchStub { display: none; }
}
`;

/**
 * The sticky documentation header: Alpine logo + wordmark, the Blog / Guides / API
 * Reference tabs, and a search stub.
 */
export function DocumentationHeader({
    surface,
    searchIndex,
    mobileMenuContent = null,
}: {
    surface: DocumentationSurface;
    searchIndex: DocumentationSearchIndex;
    mobileMenuContent?: ReactNode;
}) {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    return (
        <>
            <style dangerouslySetInnerHTML={{__html: documentationHeaderCss}} />
            <Box
                as="header"
                position="sticky"
                top="0"
                zIndex="50"
                borderBottom="grey-5"
                backgroundColor="grey-0"
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
                        ariaExpanded={mobileMenuOpen}
                        onClick={() => setMobileMenuOpen(true)}
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
                        url={surface === "blog" ? blogHomeUrl : documentationHomeUrl}
                        className="documentationHeaderHomeLink"
                        box={{display: "flex", alignItems: "center", gap: "2"}}
                    >
                        <LogoMark size="5" color="grey-90" />
                        <Box as="span" fontSize="200" fontStyle="extra-bold" color="grey-90">
                            Alpine
                        </Box>
                    </DocumentationLink>

                    <Box
                        as="nav"
                        className="documentationHeaderTabs"
                        alignItems="stretch"
                        gap="5"
                        height="full"
                    >
                        <DocumentationHeaderTab url={blogHomeUrl} active={surface === "blog"}>
                            Blog
                        </DocumentationHeaderTab>
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

            {mobileMenuOpen ? (
                <DocumentationHeaderMobileMenu
                    surface={surface}
                    onClose={() => setMobileMenuOpen(false)}
                >
                    {mobileMenuContent}
                </DocumentationHeaderMobileMenu>
            ) : null}
        </>
    );
}

/**
 * Render the mobile hamburger menu with a surface dropdown and optional docs nav.
 */
function DocumentationHeaderMobileMenu({
    surface,
    onClose,
    children,
}: {
    surface: DocumentationSurface;
    onClose: () => void;
    children: ReactNode;
}) {
    const navigate = useNavigate();

    return (
        <Box position="fixed" inset="0" zIndex="90">
            <Box
                position="absolute"
                inset="0"
                onClick={onClose}
                style={{background: "rgb(0 0 0 / 0.4)"}}
            />
            <Box
                as="aside"
                position="absolute"
                top="0"
                bottom="0"
                left="0"
                backgroundColor="grey-0"
                borderRight="grey-5"
                style={{width: 280}}
            >
                <Box
                    position="relative"
                    overflowY="auto"
                    height="full"
                    paddingX="4"
                    paddingTop="5"
                    paddingBottom="16"
                >
                    <select
                        aria-label="Documentation section"
                        value={surface}
                        onChange={event => {
                            const selectedSurface = event.currentTarget
                                .value as DocumentationSurface;
                            onClose();
                            navigate(documentationSurfaceUrlBySurface[selectedSurface]);
                        }}
                        style={{
                            appearance: "auto",
                            background: "var(--grey-1)",
                            border: "1px solid var(--grey-5)",
                            borderRadius: 6,
                            color: "var(--grey-90)",
                            font: "inherit",
                            fontSize: 16,
                            fontWeight: 600,
                            height: 44,
                            padding: "0 12px",
                            width: "100%",
                        }}
                    >
                        <option value="blog">Blog</option>
                        <option value="guides">Guides</option>
                        <option value="api">API Reference</option>
                    </select>

                    {children !== null ? <Box marginTop="5">{children}</Box> : null}
                </Box>
            </Box>
        </Box>
    );
}

const documentationSurfaceUrlBySurface = {
    blog: blogHomeUrl,
    guides: documentationHomeUrl,
    api: documentationApiHomeUrl,
} satisfies Record<DocumentationSurface, string>;

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
