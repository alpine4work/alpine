import {useSearchParams} from "@remix-run/react";
import {useEffect, useMemo, useState} from "react";
import {deserializeSiteIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {loadWithSpaceDiscovery} from "~/app/helpers/load_with_space_discovery.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {
    useCanManageSite,
    useSiteContext,
    useSiteTree,
} from "~/client/web/sites/context/site_context.js";
import {applySiteAccessPolicyChange} from "~/client/web/sites/helpers/apply_site_access_policy_change.js";
import {useSiteMenuActions} from "~/client/web/sites/site_menu_actions.js";
import {SiteNameHeader} from "~/client/web/sites/site_name_header.js";
import {SiteSideBarContent} from "~/client/web/sites/site_side_bar_content.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {peekControlsHeight} from "~/client/web/styles/peek_shared_styles.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {getSite} from "~/server/sites/data/get_site.js";
import {
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {throwError} from "~/shared/helpers/control/throw_error.js";
import {SiteLoaderData} from "~/shared/remix/site_loader_data.js";
import {Schema} from "~/shared/schema/schema.js";
import {isSiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";

const LoaderSchema = Schema.object({});

export function meta() {
    return [{title: `Site${metaTitlePostfix}`}];
}

/**
 * IMPORTANT: this route is only meant to be used for peek and mobile browsing. All
 * wide, desktop browsing should go directly through a given site's entity or the
 * empty site route if it doesn't have an entity yet.
 *
 * The site's in-order tree, full-width. Reached only by tapping the
 * `SiteBreadcrumbChip` on an entity that belongs to the site — in a peek it opens
 * within the same overlay, on mobile it's a full page. Selecting an entry
 * navigates on to that entity (staying in the peek). This is deliberately a
 * separate route from `site.$siteId._index` so the site's normal preview behavior
 * (peeking a `Site` shows its first entity) is left untouched.
 */
export async function loader({params, context: unauthenticatedContext, request}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();

    const url = new URL(request.url);
    const siteId = deserializeSiteIdForLoader(params.siteId);

    const consistency = url.searchParams.get("consistency") === "strong" ? "Strong" : "Eventual";

    // The entity the user came from, so the tree can highlight and scroll to it.
    let activeEntityIdParam = url.searchParams.get("activeEntityId");
    activeEntityIdParam = activeEntityIdParam && decodeURIComponent(activeEntityIdParam);
    const activeEntityId =
        activeEntityIdParam && isSiteItemSearchEntityId(activeEntityIdParam)
            ? activeEntityIdParam
            : undefined;

    const activeSiteId = request.headers.get("cyberworlds-active-site-id")?.trim();

    let siteLoaderData: SiteLoaderData;

    if (activeSiteId && activeSiteId === siteId) {
        siteLoaderData = {type: "UseActiveSite", siteId, activeEntityId};
    } else {
        const {
            data1: partialResult,
            data2: isFavorite = throwError(
                new InternalError("Expected `SpaceId` to be discovered"),
            ),
        } = await loadWithSpaceDiscovery(context, {
            load1: async () => {
                return {
                    type: "UseNewSite" as const,
                    siteId,
                    initialQueryResult: await getSite(context, {siteId, consistency}),
                    activeEntityId,
                };
            },
            load2: async ({spaceId}) => {
                return await isSearchFavoriteEntity(context, {spaceId, entityId: `Site:${siteId}`});
            },
        });

        siteLoaderData = {...partialResult, isFavorite};
    }

    return jsonWithSchema(LoaderSchema, {}, {siteLoaderData});
}

export default function SiteNavigateRoute() {
    const context = useAppContext();
    const tree = useSiteTree();
    const {handleEventForSite} = useSiteContext();
    const {currentAccount} = useSpaceContext();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const [searchParams, setSearchParams] = useSearchParams();
    const canManage = useCanManageSite();

    const isMobile = platform === "mobile";

    const shouldFocusNameInput = searchParams.get("focus") === "name";

    const [isEditingNameInline, setIsEditingNameInline] = useState(
        canManage && platform !== "mobile" && shouldFocusNameInput,
    );
    if (isEditingNameInline && platform === "mobile") setIsEditingNameInline(false);

    const accessPolicy = tree.site.accessPolicy;

    const accessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
        [accessPolicy, currentAccount?.id],
    );

    // Strip the consumed `?focus` param so a refresh doesn't replay it and it doesn't
    // end up in shared links.
    useEffect(() => {
        if (!searchParams.has("focus")) return;
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.delete("focus");
        setSearchParams(newSearchParams, {replace: true});
    }, [searchParams, setSearchParams]);

    const menuActions = useSiteMenuActions({
        editSiteNameAction:
            hasAccessLevel(accessLevel, "Manage") && !isMobile
                ? cast<MenuAction>({
                      label: "Edit name",
                      onPress: () => {
                          setIsEditingNameInline(true);
                      },
                  })
                : undefined,
    });

    const site = tree.site;

    const rootEntry = tree.getEntry(site.rootContainerId);
    // TODO(#sites-top-bar): Support top bar-rooted sites.
    assert(rootEntry.type === "SideBar");

    const {scrollViewRef, navigationBar, scrollbarInsetTop, effectiveNavigationBarHeight} =
        useNavigationBar({
            title: (
                <SiteNameHeader
                    site={site}
                    setIsEditingNameInline={setIsEditingNameInline}
                    isEditingNameInline={isEditingNameInline}
                />
            ),
            desktopTitleFontSize: "400",
            desktopTitleFontWeight: "bold",
            desktopTitleLeftSlop: "1",
            titleJustifyContent: isMobile ? "center" : "flex-start",
            withoutDisappearingTitle: true,
            // If the user lands here without browser history (e.g. opening a deep link), fall
            // back to the bare site URL — its `firstEntityId` redirect then sends them into
            // the actual entity tree.
            defaultPreviousRoute: `/site/${site.id}`,
            menuActions,
            shareButton: {
                entityNoun: "site",
                entityId: `Site:${site.id}`,
                accessPolicy: site.accessPolicy,
                onAccessPolicyChange: async (notification, accessPolicy) => {
                    await applySiteAccessPolicyChange({
                        context,
                        accessPolicy: {...accessPolicy, type: "Site", siteId: site.id},
                        handleEventForSite,
                    });
                },
                onCopyLink: async () => {
                    const url = new URL(`/site/${site.id}`, window.location.href);
                    await writeTextToClipboard(url.toString());
                },
            },
        });

    // TODO(#sites-redesign): Mostly for calebmer, we may want to iterate on this
    // design. Specifically in peek (and secondarily, "wide") view.
    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(
                scrollViewRef,
                useScrollbar({insetTop: scrollbarInsetTop}),
            )}
            data-testid="SiteNavigateView"
            flexShrink="0"
            overflow="auto"
            height="full"
            width="full"
            position="relative"
        >
            <Box display="flex" flexDirection="column" gap="0.5" minHeight="full">
                <Box
                    style={{
                        height:
                            routeLayout === "narrow" && platform !== "mobile"
                                ? addRemLengths(effectiveNavigationBarHeight, peekControlsHeight)
                                : effectiveNavigationBarHeight,
                    }}
                />
                <Box marginLeft={platform === "mobile" ? "4" : "6"}>
                    <SiteSideBarContent
                        item={rootEntry}
                        isFullWidth={true}
                        withoutNameHeader={true}
                    />
                </Box>
                {navigationBar}
            </Box>
        </Box>
    );
}
