import {redirect} from "@remix-run/node";
import {ShouldRevalidateFunction, useSearchParams} from "@remix-run/react";
import {Plus} from "phosphor-react";
import {useCallback, useEffect, useState} from "react";
import {
    deserializeSiteIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {loadWithSpaceDiscovery} from "~/app/helpers/load_with_space_discovery.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {MenuActions} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {AddExistingEntityToSiteModal} from "~/client/web/sites/add_existing_entity_to_site_modal.js";
import {
    useCanManageSite,
    useSite,
    useSiteContext,
    useSiteTree,
} from "~/client/web/sites/context/site_context.js";
import {applySiteAccessPolicyChange} from "~/client/web/sites/helpers/apply_site_access_policy_change.js";
import {SiteChrome} from "~/client/web/sites/site_chrome.js";
import {useAddEntityToSiteMenuActions} from "~/client/web/sites/use_add_entity_to_site_menu_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeSiteAccess} from "~/server/sites/data/authorize_site_access.js";
import {createSite} from "~/server/sites/data/create_site.js";
import {getSite} from "~/server/sites/data/get_site.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {throwError} from "~/shared/helpers/control/throw_error.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {convertSpacePathToPeekPath} from "~/shared/remix/peek_path_helpers.js";
import {SiteLoaderData} from "~/shared/remix/site_loader_data.js";
import {Schema} from "~/shared/schema/schema.js";
import {getSearchDynamicEntityPathFromEntityIdObject} from "~/shared/search/path/get_search_entity_path.js";
import {parseSiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SitePreviewModel, SitePreviewModelData} from "~/shared/sites/site_model.js";

const LoaderSchema = Schema.object({});

export function meta() {
    return [{title: `Site${metaTitlePostfix}`}];
}

export async function loader({params, context: unauthenticatedContext, request}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();

    const url = new URL(request.url);
    const siteId = deserializeSiteIdForLoader(params.siteId);
    const createSearchParam = url.searchParams.get("create");

    if (createSearchParam !== null && createSearchParam.length === 0) {
        throw new FailedPreconditionError("Expected `create` search param to include a space id");
    }
    const createSpaceId =
        createSearchParam !== null ? deserializeSpaceIdForLoader(createSearchParam) : null;
    if (createSpaceId !== null) {
        context.discovery.discoverSpaceId(createSpaceId, "CreateSearchParam");
    }

    // The "create site" flow generates the `siteId` on the client and navigates here
    // with `?create={spaceId}` (mirroring the document and task-collection create
    // flows). Create the site before loading it. Putting the client-generated id in
    // the URL and treating a `FailedPrecondition` as a no-op keeps this GET
    // idempotent: prefetch, refresh, and "open in new tab" all target the same
    // `siteId`, so at most one site is ever created.
    if (createSpaceId !== null) {
        try {
            await createSite(context.actor.authorizeSession(), {
                spaceId: createSpaceId,
                siteId,
                name: "New site",
                root: {type: "SideBar"},
            });
        } catch (error) {
            if (!(error instanceof FailedPreconditionError)) {
                throw error;
            }

            // Creation failed its `attribute_not_exists` condition, so the site already
            // exists. Confirm the actor can view it before falling through to render — if they
            // can't, this surfaces a proper authorization error.
            await authorizeSiteAccess(context, siteId, "View");
        }
    }

    const consistency = url.searchParams.get("consistency") === "strong" ? "Strong" : "Eventual";

    const activeSiteId = request.headers.get("cyberworlds-active-site-id")?.trim();

    let siteLoaderData: SiteLoaderData;

    if (activeSiteId && activeSiteId === siteId) {
        siteLoaderData = {type: "UseActiveSite", siteId};
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
                };
            },
            load2: async ({spaceId}) => {
                return await isSearchFavoriteEntity(context, {spaceId, entityId: `Site:${siteId}`});
            },
        });

        siteLoaderData = {...partialResult, isFavorite};
    }

    const sitePreviewIfUseNewSite =
        siteLoaderData.type === "UseNewSite"
            ? findMapIterable(siteLoaderData.initialQueryResult.items, item =>
                  item.model instanceof SitePreviewModel ? item.model.initialData : undefined,
              )
            : undefined;

    if (sitePreviewIfUseNewSite?.firstEntityId) {
        const idObject = parseSiteItemSearchEntityId(sitePreviewIfUseNewSite.firstEntityId);
        const path = getSearchDynamicEntityPathFromEntityIdObject(
            sitePreviewIfUseNewSite.spaceId,
            idObject,
            "wide",
        );

        // The peek embed runs its own router whose route table only contains routes under
        // `routes/_space.peek`. A space-path redirect would 404 inside it, so when this
        // loader is running for a peek request rewrite the target to the matching peek
        // path.
        const isPeekRequest = url.pathname.startsWith(`/peek/site/${siteId}`);
        const peekPath = isPeekRequest
            ? convertSpacePathToPeekPath({pathname: path, search: "", hash: ""})
            : null;

        // In local development, surface internal navigations that hit `/site/$siteId`
        // directly when the site already has a first entity — those should navigate to the
        // entity URL up front instead of bouncing through this redirect. Peek requests are
        // the legitimate paste/mention/preview path, and a cross-origin referer means the
        // user clicked a shared link from somewhere else (also legitimate). Scoped to
        // `NODE_ENV === "development"` (rather than `!== "production"`) so screenshot
        // tests and integration tests — which run with `NODE_ENV === "test"` and navigate
        // through the bare URL — don't trip the check.
        if (process.env.NODE_ENV === "development") {
            throw new InternalError(
                `Internal navigation to bare \`/site/${siteId}\` when the site already ` +
                    `has a \`firstEntityId\`. The caller should navigate to ${path} ` +
                    `directly.`,
            );
        }

        return redirect(peekPath?.pathname ?? path);
    }

    return jsonWithSchema(LoaderSchema, {}, {siteLoaderData});
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: originalCurrentUrl,
    nextUrl: originalNextUrl,
}) => {
    const currentUrl = new URL(originalCurrentUrl);
    const nextUrl = new URL(originalNextUrl);

    // The client removes the `create` and `consistency` search params after creating a
    // new site. Don't revalidate when the client does this.
    currentUrl.searchParams.delete("create");
    nextUrl.searchParams.delete("create");
    currentUrl.searchParams.delete("consistency");
    nextUrl.searchParams.delete("consistency");

    return nextUrl.toString() !== currentUrl.toString();
};

type SearchModalState = {
    readonly parentId: SiteContainerId;
    readonly getNextOrderKey: (previousOrderKey: OrderKey | null) => OrderKey;
};

export default function SiteRoute() {
    const site = useSite();
    const tree = useSiteTree();
    const canManage = useCanManageSite();
    const [searchModalState, setSearchModalState] = useState<SearchModalState | null>(null);

    // Remove the `create` and `consistency` search params after they've been consumed
    // by the loader.
    const [searchParams, setSearchParams] = useSearchParams();
    const hasSearchParamToDelete = searchParams.has("create") || searchParams.has("consistency");
    useEffect(() => {
        if (hasSearchParamToDelete) {
            setSearchParams(
                oldSearchParams => {
                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    newSearchParams.delete("create");
                    newSearchParams.delete("consistency");
                    return newSearchParams;
                },
                {replace: true},
            );
        }
    }, [hasSearchParamToDelete, setSearchParams]);

    const rootChildren = tree.getChildrenForParent(site.rootContainerId);
    const lastRootChildKey = rootChildren[rootChildren.length - 1]?.orderKey ?? null;
    const getRootNextOrderKey = useCallback(
        (previousOrderKey: OrderKey | null) =>
            generateOrderKeyBetween(previousOrderKey ?? lastRootChildKey, null),
        [lastRootChildKey],
    );
    const rootAddEntityMenuActions = useAddEntityToSiteMenuActions({
        parentId: site.rootContainerId,
        getOrderKey: () => getRootNextOrderKey(null),
        onSearchExisting: () =>
            setSearchModalState({
                parentId: site.rootContainerId,
                getNextOrderKey: getRootNextOrderKey,
            }),
    });

    return (
        <Box
            flexGrow="1"
            position="relative"
            zIndex="0"
            overflow="hidden"
            display="flex"
            flexDirection="column"
            marginLeft="8"
        >
            <SiteChrome tree={tree} parentId={site.rootContainerId}>
                <EmptySiteContent
                    site={site}
                    canManage={canManage}
                    rootAddEntityMenuActions={rootAddEntityMenuActions}
                />
            </SiteChrome>
            {searchModalState && (
                <AddExistingEntityToSiteModal
                    parentId={searchModalState.parentId}
                    getNextOrderKey={searchModalState.getNextOrderKey}
                    onClose={() => setSearchModalState(null)}
                />
            )}
        </Box>
    );
}

function EmptySiteContent({
    site,
    canManage,
    rootAddEntityMenuActions,
}: {
    site: SitePreviewModelData;
    canManage: boolean;
    rootAddEntityMenuActions: MenuActions;
}) {
    const context = useAppContext();
    const siteContext = useSiteContext();

    const {navigationBar} = useNavigationBar({
        shareButton: {
            entityNoun: "site",
            entityId: `Site:${site.id}`,
            accessPolicy: site.accessPolicy,
            onAccessPolicyChange: async (notification, accessPolicy) => {
                assert(accessPolicy.type === "Local");
                await applySiteAccessPolicyChange({
                    context,
                    accessPolicy: {...accessPolicy, type: "Site", siteId: site.id},
                    handleEventForSite: siteContext.handleEventForSite,
                });
            },
            onCopyLink: async () => {
                const url = new URL(`/site/${site.id}`, window.location.href);
                await writeTextToClipboard(url.toString());
            },
        },
    });

    // TODO(#sites): The empty site in peek mode needs some work. I'm not exactly sure
    // what it should look like, but we can't ship as is.
    return (
        <Box
            flexGrow="1"
            minWidth="flex-fit"
            position="relative"
            zIndex="0"
            overflow="hidden"
            height="full"
            width="full"
        >
            {navigationBar}
            <Box
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                height="full"
                width="full"
                padding="6"
            >
                <Box
                    display="flex"
                    flexDirection="column"
                    gap="2"
                    alignItems="center"
                    maxWidth="1/3"
                    textAlign="center"
                >
                    {canManage && (
                        <Box fontSize="200" fontStyle="bold">
                            Start building {site.name}
                        </Box>
                    )}
                    <Box fontSize="100" color="grey-50">
                        {canManage
                            ? "Add a document, channel, task, or task collection to get started."
                            : // TODO(#sites-redesign): Maybe add messaging to inform user that they don't have
                              // the ability to add anything to the site, and that they should ask someone who
                              // can share the site to give them ability to add content.
                              "This site doesn\u2019t have any content yet and you don\u2019t have permission to add any. Contact a site administrator to get access."}
                    </Box>
                    {canManage && (
                        <Box paddingTop="2">
                            <MenuButton actions={rootAddEntityMenuActions} placement="bottom">
                                {/* TODO(#sites-redesign): Maybe add quick buttons for each entity type? */}
                                <Button icon={<Plus size={14} />}>Add to site</Button>
                            </MenuButton>
                        </Box>
                    )}
                </Box>
            </Box>
        </Box>
    );
}
