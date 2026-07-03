import {CaretRight} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {
    navigationBarBreadcrumbToTitleSpacing,
    navigationBarTitleBreadcrumbButtonHeight,
    navigationBarTitleBreadcrumbCaretSize,
    navigationBarTitleBreadcrumbColor,
    navigationBarTitleBreadcrumbFontSize,
} from "~/client/web/design/navigation_bar_helpers.js";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSiteContextIfExists} from "~/client/web/sites/context/site_context.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {convertSpacePathToPeekPath} from "~/shared/remix/peek_path_helpers.js";

/**
 * IMPORTANT: This design also exists in `navigation_bar_content.tsx` under
 * `NavigationBarTitleBreadcrumbButton` and `TaskDetailViewParentBreadcrumbs`. When
 * updating this component, also update those components.
 *
 * The `[Site name] ›` breadcrumb shown next to an entity's title when the entity
 * is viewed in a narrow layout (mobile or a peek) and belongs to a site.
 *
 * Visually identical to `TaskDetailViewParentBreadcrumbs`: a
 * `<Button variant="quietest">` for the site link followed by a trailing
 * `<CaretRight>` separator, with `grey-50` cascading from the outer flex
 * container. Same `height`/`paddingX`/`fontSize`/caret tokens as the task parent
 * chain so the two read as one pattern. The file-entity preview helper
 * (`renderContentFileEntitySiteBreadcrumb`) mirrors the same tokens for its
 * static-HTML counterpart.
 *
 * Tapping it opens the site's `navigate` route; peek-aware via
 * `convertSpacePathToPeekPath`.
 */
export function SiteBreadcrumbChip({withoutCaret}: {withoutCaret?: boolean}) {
    const routeLayout = useRouteLayout();
    const platform = usePlatform();
    // Read the site via the `IfExists` variant — the chip is rendered unconditionally
    // by every entity's detail view, and the non-throwing accessor lets us gracefully
    // self-gate to `null` when the entity isn't in a site (instead of crashing the
    // peek/page).
    const siteContext = useSiteContextIfExists();
    const peekContext = usePeekContext();
    const navigate = useNavigate();

    if (routeLayout !== "narrow" || !siteContext) return null;

    // If we're rendering this breadcrumb chip, then we are rendering a site entity.
    // It's impossible for `activeEntityId` to be `null` here.
    const {activeEntityId} = siteContext.activeState;

    const site = siteContext.tree.site;

    const openSite = async () => {
        const path = {
            pathname: `/site/${site.id}/navigate`,
            search: `activeEntityId=${encodeURIComponent(assertExists(activeEntityId))}`,
            hash: "",
        };
        const to = peekContext ? (convertSpacePathToPeekPath(path) ?? path) : path;
        await navigate(to, {
            unstable_headers: {
                "cyberworlds-active-site-id": site.id,
            },
        });
    };

    // We don't want to render the caret in the mobile nav bar. However, there are some
    // cases (e.g. documents) that render the breadcrumb chip on mobile outside of the
    // nav bar. In these cases, you can override the behavior by passing
    // `withoutCaret={false}`.
    withoutCaret ??= platform === "mobile";

    return (
        <Box
            display="flex"
            alignItems="center"
            minWidth="0"
            color={navigationBarTitleBreadcrumbColor}
            marginLeft="-1.5"
            paddingBottom={navigationBarBreadcrumbToTitleSpacing[platform]}
        >
            <Box flexShrink="1" minWidth="flex-fit" maxWidth="full">
                <Button
                    variant="quietest"
                    // The title's grown top clearance (`withTitleSiteBreadcrumbDocClassName`) derives
                    // from this constant — keep them in sync.
                    height={navigationBarTitleBreadcrumbButtonHeight}
                    paddingX="1.5"
                    fontSize={navigationBarTitleBreadcrumbFontSize}
                    pressErrorTitle="Couldn&#x2019;t open site"
                    onPress={openSite}
                >
                    {site.name}
                </Button>
            </Box>
            {!withoutCaret && (
                <CaretRight
                    size={spacing[navigationBarTitleBreadcrumbCaretSize]}
                    style={{flexShrink: 0}}
                />
            )}
        </Box>
    );
}
