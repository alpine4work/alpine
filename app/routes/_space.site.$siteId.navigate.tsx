import {Link as LinkIcon} from "phosphor-react";
import {useMemo} from "react";
import {deserializeSiteIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {loadWithSpaceDiscovery} from "~/app/helpers/load_with_space_discovery.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {
    useFavoriteSiteMenuAction,
    useSiteContext,
    useSiteTree,
} from "~/client/web/sites/context/site_context.js";
import {applySiteAccessPolicyChange} from "~/client/web/sites/helpers/apply_site_access_policy_change.js";
import {SiteSideBarContent} from "~/client/web/sites/site_side_bar_content.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {getSite} from "~/server/sites/data/get_site.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {throwError} from "~/shared/helpers/control/throw_error.js";
import {SiteLoaderData} from "~/shared/remix/site_loader_data.js";
import {Schema} from "~/shared/schema/schema.js";
import {isSiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";

const LoaderSchema = Schema.object({});

export function meta() {
    return [{title: `Site${metaTitlePostfix}`}];
}

// TODO(#sites): I'm still not sure I love the idea of a new route vs. a flyover
// menu. So right now the flow is
//
// 1. User opens an entity in peek/mobile that belongs to a site.
// 2. User clicks the site breadcrumb chip.
// 3. User is navigated to the site navigate route.
//
// What happens when the user clicks expand? We open the navigate route in wide
// screen? Anyway, I'm not convinced this is the right approach but I think we can
// try it for now and see how it feels.
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
    const focusParam = url.searchParams.get("focus");
    const activeEntityId =
        focusParam && isSiteItemSearchEntityId(focusParam) ? focusParam : undefined;

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
    const {space} = useSpaceContext();
    const platform = usePlatform();
    const favoriteSiteMenuAction = useFavoriteSiteMenuAction();

    const site = tree.site;

    const rootEntry = tree.getEntry(site.rootContainerId);
    // TODO(#sites-top-bar): Support top bar-rooted sites.
    assert(rootEntry.type === "SideBar");

    const menuActions = useMemo<ReadonlyArray<ReadonlyArray<MenuAction>>>(
        () => [
            [
                ...(favoriteSiteMenuAction ? [favoriteSiteMenuAction] : []),
                {
                    label: "Copy link",
                    icon: <LinkIcon size={16} />,
                    pressErrorTitle: "Couldn\u2019t copy link",
                    onPress: async () => {
                        const url = new URL(
                            `/s/${space.id}/sites/${site.id}`,
                            window.location.href,
                        );
                        await writeTextToClipboard(url.toString());
                    },
                },
            ],
        ],
        [favoriteSiteMenuAction, space.id, site.id],
    );

    // TODO(#sites): eshould reroute to site if a user tries to expand this peek view.
    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        title: site.name,
        withoutDisappearingTitle: true,
        // If the user lands here without browser history (e.g. opening a deep link), fall
        // back to the bare site URL — its `firstEntityId` redirect then sends them into
        // the actual entity tree.
        defaultPreviousRoute: `/s/${space.id}/sites/${site.id}`,
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
                const url = new URL(`/s/${space.id}/sites/${site.id}`, window.location.href);
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
            flexGrow="1"
            width="full"
            height="full"
            position="relative"
            zIndex="0"
            overflowX="hidden"
            overflowY="auto"
        >
            {navigationBar}
            <Box height={navigationBarHeight} />
            <Box
                marginLeft={platform === "mobile" ? "4" : "6"}
                paddingTop={platform === "mobile" ? "0" : "4"}
            >
                <SiteSideBarContent item={rootEntry} isFullWidth={true} withoutNameHeader={true} />
            </Box>
        </Box>
    );
}
