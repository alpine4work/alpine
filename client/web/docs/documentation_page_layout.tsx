import {useLocation} from "@remix-run/react";
import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {
    DocumentationHeader,
    DocumentationSurface,
} from "~/client/web/docs/internal/documentation_header.js";
import {DocumentationSearchIndex} from "~/client/web/docs/search_documentation_entries.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

const documentationHeaderHeight = 56;

// Width-based responsive rules. Our sprinkles conditions are platform-based
// (mobile/desktop) rather than viewport-width based, so the docs' column
// collapsing lives in one small scoped stylesheet: the right rail hides under
// ~1100px and the left sidebar collapses into a drawer under ~860px.
const documentationLayoutCss = `
.documentationLayoutGrid { grid-template-columns: 264px minmax(0, 1fr) 300px; }
.documentationCodeGuide { grid-template-columns: minmax(220px, 0.42fr) minmax(0, 1fr); }
@media (max-width: 1100px) {
    .documentationLayoutGrid { grid-template-columns: 264px minmax(0, 1fr); }
    .documentationRightRail { display: none; }
}
@media (max-width: 860px) {
    .documentationLayoutGrid { grid-template-columns: minmax(0, 1fr); }
    .documentationSidebar { display: none; }
    .documentationMainContent {
        padding-left: ${spacing["6"]};
        padding-right: ${spacing["6"]};
    }
    .documentationCodeGuide { grid-template-columns: minmax(0, 1fr); }
}
`;

/**
 * The shared three-column docs shell: sticky header on top, then sidebar / content
 * / right rail centered at a 1440px max width.
 */
export function DocumentationPageLayout({
    surface,
    searchIndex,
    sidebar,
    rightRail,
    rightRailBorder = false,
    contentWidth,
    children,
}: {
    surface: DocumentationSurface;
    searchIndex: DocumentationSearchIndex;
    sidebar: ReactNode;
    rightRail: ReactNode;
    rightRailBorder?: boolean;
    contentWidth: "prose" | "reference";
    children: ReactNode;
}) {
    const {pathname} = useLocation();

    const sidebarScrollbarRef = useScrollbar<HTMLElement>();
    const rightRailScrollbarRef = useScrollbar<HTMLElement>();

    let contentStyle;
    switch (contentWidth) {
        case "prose":
            contentStyle = {maxWidth: 768, margin: "0 auto"};
            break;
        case "reference":
            contentStyle = {maxWidth: 900};
            break;
        default:
            throw exhaustive(contentWidth);
    }

    return (
        <Box
            minHeight="full"
            backgroundColor="grey-0"
            color="grey-90"
            style={{minHeight: "100svh"}}
        >
            <style dangerouslySetInnerHTML={{__html: documentationLayoutCss}} />

            {/* Point AI agents and tools at the markdown version of this page. The
                `<link rel="alternate">` is the machine-standard signal (React hoists it
                into `<head>`); the hidden note is a plain-language fallback for anything
                reading the HTML body. Both are invisible to people. */}
            <link rel="alternate" type="text/markdown" href={`${pathname}.md`} />
            <Box as="div" hidden data-docs-markdown-hint>
                This documentation is also available as markdown for AI agents and tools. Append
                `.md` to any docs URL to get the markdown version of a page. For this page, that is{" "}
                {`${pathname}.md`}. The docs home is available at `/docs.md`.
            </Box>

            <DocumentationHeader
                surface={surface}
                searchIndex={searchIndex}
                mobileMenuContent={sidebar}
            />

            <Box
                className="documentationLayoutGrid"
                display="grid"
                alignItems="stretch"
                marginX="center"
                style={{maxWidth: 1440}}
            >
                <Box
                    as="aside"
                    className="documentationSidebar"
                    position="sticky"
                    borderRight="grey-5"
                    style={{
                        top: documentationHeaderHeight,
                        height: `calc(100vh - ${documentationHeaderHeight}px)`,
                        alignSelf: "start",
                    }}
                >
                    {/* The scrollbar needs a `position: relative` scroll container,
                        which the sticky aside itself can't be. */}
                    <Box
                        ref={sidebarScrollbarRef}
                        position="relative"
                        overflowY="auto"
                        height="full"
                        paddingX="4"
                        paddingTop="6"
                        paddingBottom="16"
                    >
                        {sidebar}
                    </Box>
                </Box>

                <Box
                    as="main"
                    className="documentationMainContent"
                    id="docs-content"
                    minWidth="flex-fit"
                    paddingX="13"
                    paddingTop="10"
                    paddingBottom="28"
                    width="full"
                    style={contentStyle}
                >
                    {children}
                </Box>

                <Box
                    as="aside"
                    className="documentationRightRail"
                    position="sticky"
                    borderLeft={rightRailBorder ? "grey-5" : "transparent"}
                    style={{
                        top: documentationHeaderHeight,
                        height: `calc(100vh - ${documentationHeaderHeight}px)`,
                        alignSelf: "start",
                    }}
                >
                    <Box
                        ref={rightRailScrollbarRef}
                        position="relative"
                        overflowY="auto"
                        height="full"
                        paddingX="5"
                        paddingTop="10"
                        paddingBottom="20"
                    >
                        {rightRail}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
