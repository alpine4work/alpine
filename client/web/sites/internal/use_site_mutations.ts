import {useCallback} from "react";
import {flushSync} from "react-dom";
import {NavigateOptions} from "react-router";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {
    getSearchDynamicEntityPath,
    getSearchDynamicEntityPathFromEntityIdObject,
} from "~/client/web/search/core/get_search_entity_path.js";
import {useSiteActivation, useSiteContext} from "~/client/web/sites/context/site_context.js";
import {computeAdjacentEntityId} from "~/client/web/sites/internal/compute_adjacent_entity_id.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {
    ChannelId,
    DocumentId,
    SiteSideBarSectionId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {createDocument} from "~/shared/rpc/documents_rpc_definitions.js";
import {createChannel} from "~/shared/rpc/forum_rpc_definitions.js";
import {
    addEntityToSite,
    createSiteContainer,
    deleteSiteContainer,
    moveSiteEntry,
    removeEntityFromSite,
    updateSiteContainerLabel,
    updateSiteName,
} from "~/shared/rpc/sites_rpc_definitions.js";
import {commitTaskActionTransaction} from "~/shared/rpc/tasks_rpc_definitions.js";
import {SearchEntityModelData} from "~/shared/search/search_entity_model.js";
import {
    SiteItemSearchEntityId,
    isSiteItemSearchEntityId,
    parseSiteItemSearchEntityId,
} from "~/shared/search/site_item_search_entity_id.js";
import {doesSiteEntryMoveIntroduceCycle} from "~/shared/sites/does_site_entry_move_introduce_cycle.js";
import {mergeNewSitePositionIntoSiteEntry} from "~/shared/sites/merge_new_site_position_into_site_entry.js";
import {
    SiteContainerId,
    SiteSideBarContainerId,
    SiteSideBarSectionContainerId,
    isSiteSideBarContainerId,
    isSiteSideBarSectionContainerId,
    parseSiteContainerId,
    parseSiteSideBarSectionContainerId,
    printSiteContainerId,
} from "~/shared/sites/site_entry_id.js";
import {SiteSideBarSectionModel} from "~/shared/sites/site_model.js";
import {validateSiteContainerIsEmpty} from "~/shared/sites/validate_site_container_is_empty.js";

/**
 * Hook that provides mutation functions for editing a site's tree. Each mutation
 * applies an optimistic update immediately and reverts on failure.
 */
export function useSiteMutations() {
    const context = useAppContext();
    const reporter = useReporter();
    const clientInfo = useClientInfo();
    const {activeSiteId} = useSiteActivation();
    const {space, currentAccount} = useSpaceContext();
    const {
        tree,
        updateTreeOptimistically,
        handleEventForSite,
        activeState,
        withPausedRealtimeEvents,
    } = useSiteContext();
    const routeLayout = useRouteLayout();
    const _navigate = useNavigate();

    const navigateWithinSite = useCallback(
        (to: string, options?: NavigateOptions) => {
            return _navigate(to, {
                ...options,

                // Without this parameter, navigating to another entity in the site will open the
                // new entity in a peek view instead of "replacing" the current route with the next
                // entity's route.
                replace: true,

                // When navigating within a site, we send some header data to the server to let it
                // know that it doesn't need to re-fetch the site with all of its items. When a
                // site is active, we've already performed an initial query against the site item
                // and are subscribed to udpate events.
                unstable_headers: activeSiteId
                    ? {
                          "cyberworlds-active-site-id": activeSiteId,
                      }
                    : undefined,
            });
        },
        [activeSiteId, _navigate],
    );

    const siteId = tree.site.id;

    const createSidebarSection = useCallback(
        ({
            parentId,
            label = "New section",
            orderKey: orderKeyOverride,
        }: {
            parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
            label?: string;
            orderKey?: OrderKey;
        }) => {
            const sectionId = generateId<SiteSideBarSectionId>();
            const sectionContainerId = printSiteContainerId({
                type: "SideBarSection",
                id: sectionId,
            });

            const orderKey =
                orderKeyOverride ??
                (() => {
                    const siblings = tree.getChildrenForParent(parentId);
                    const lastSibling = siblings.length > 0 ? siblings[siblings.length - 1] : null;
                    return generateOrderKeyBetween(lastSibling?.orderKey ?? null, null);
                })();

            const rpcPromise = createSiteContainer(context, {
                siteId,
                container: {
                    type: "SideBarSection",
                    id: sectionId,
                    parent: parseSiteContainerId(parentId),
                },
                label,
                orderKey,
            });

            // Discard the RPC result for the optimistic hook — we only care about
            // success/failure, not the returned event stubs.
            updateTreeOptimistically(
                rpcPromise
                    .then(result => handleEventForSite(result.events))
                    .catch(error => {
                        reporter.displayError("Couldn\u2019t create sidebar section", error);
                        throw error;
                    }),
                // if promise value is defined, that means promise resolved before optimistic
                // update ran
                (oldTree, promiseValue) => {
                    // If promise value is defined, that means rpcPromise resolved and
                    // handleEventForSite() has run. Since handleEventForSite() will incorporate the
                    // update into our store we can simply return oldTree from here as an optimization.
                    if (promiseValue !== undefined) {
                        return oldTree;
                    }

                    return oldTree.addEntry(
                        new SiteSideBarSectionModel({
                            type: "SideBarSection",
                            id: `SideBarSection:${sectionId}`,
                            label,
                            orderKey,
                            parentId,
                            version: 0,
                        }),
                    );
                },
            );

            return {sectionId, sectionContainerId};
        },
        [context, handleEventForSite, reporter, siteId, tree, updateTreeOptimistically],
    );

    // NOTE(ifitzsimmons, 2026-04-21): `addEntity`, `removeEntity`, and all entity
    // creation (creating docs, tasks, etc) are blocking operations. This is a
    // deliberate latency tradeoff.
    //
    // The alternative is to fire the RPC in the background and navigate immediately.
    // That's faster perceptually, but it involves updating the site tree with the
    // recently-added entity before the entity's access policy reflects the site
    // operation. Any UI driven by that policy (share switch, permission- gated
    // content, site chrome) would render based on stale truth for the window between
    // navigate and RPC resolution, which presents a correctness problem.
    //
    // We accept the extra RPC round-trip to guarantee the destination route always
    // loads against server-consistent access policy state. The client should handle
    // the lag between user-action and site addition gracefully.
    const addEntity = useCallback(
        async ({
            entity,
            orderKey,
            parentId,
        }: {
            entity: SearchEntityModelData & {id: SiteItemSearchEntityId};
            orderKey: OrderKey;
            parentId: SiteContainerId;
        }): Promise<{entityId: SiteItemSearchEntityId}> => {
            // NOTE(ifitzsimmons, #pause-site-realtime-events): Without pausing the realtime
            // events, the entity may appear in the site chrome before we navigate to it.
            return await withPausedRealtimeEvents(async () => {
                // TODO(#sites): How should we handle entities in other sites? For now, we add them
                // to the new site if possible, otherwise we throw an access error.
                const {events} = await addEntityToSite(context, {
                    siteId,
                    spaceId: space.id,
                    entityId: entity.id,
                    parentId,
                    orderKey,
                });

                // NOTE(ifitzsimmons, 2026-04-29): We typically navigate to a new route after
                // adding an entity to a site, removing an entity from a site, etc. When doing
                // this, we want to make sure that the site chrome is updated in the same browser
                // paint as when we navigate to new route.
                //
                // So as an example of what we are trying to avoid, when we remove an entity from a
                // site, we remove it and navigate to the next entity. Without using `flushSync`,
                // you'd probaly see the entity disappear from the site chrome before actually
                // navigating to the next entity, which introduces some pretty obvious screen
                // flicker.
                await navigateWithinSite(getSearchDynamicEntityPath(space.id, entity, routeLayout));
                flushSync(() => handleEventForSite(events));

                return {entityId: entity.id};
            });
        },
        [
            context,
            handleEventForSite,
            navigateWithinSite,
            routeLayout,
            siteId,
            space.id,
            withPausedRealtimeEvents,
        ],
    );

    const addMultipleEntities = useCallback(
        async (
            entities: Array<{
                entityId: SiteItemSearchEntityId;
                orderKey: OrderKey;
                parentId: SiteContainerId;
            }>,
        ) => {
            // NOTE(ifitzsimmons, #pause-site-realtime-events): Without pausing the realtime
            // events, the entity may appear in the site chrome before we navigate to it.
            return await withPausedRealtimeEvents(async () => {
                // TODO(#sites): How should we handle entities in other sites? For now, we add them
                // to the new site if possible, otherwise we throw an access error. \
                // TODO(#sites): Handle errors
                const eventTransactions = await runAllPromises(
                    entities.map(entity =>
                        addEntityToSite(context, {
                            siteId,
                            spaceId: space.id,
                            ...entity,
                        }),
                    ),
                );

                handleEventForSite(eventTransactions.flatMap(result => result.events));
            });
        },
        [context, handleEventForSite, space.id, siteId, withPausedRealtimeEvents],
    );

    const deleteContainer = useCallback(
        (containerId: SiteSideBarContainerId | SiteSideBarSectionContainerId) => {
            validateSiteContainerIsEmpty(containerId, tree);

            const rpcPromise = deleteSiteContainer(context, {
                siteId,
                container: parseSiteContainerId(containerId),
            });

            updateTreeOptimistically(
                rpcPromise.then(result => handleEventForSite(result.events)),
                (oldTree, promiseValue) => {
                    // If promise value is defined, that means rpcPromise resolved and
                    // handleEventForSite() has run. Since handleEventForSite() will incorporate the
                    // update into our store we can simply return oldTree from here as an optimization.
                    if (promiseValue !== undefined) {
                        return oldTree;
                    }

                    return oldTree.deleteEntry(containerId);
                },
            );
        },
        [context, handleEventForSite, siteId, tree, updateTreeOptimistically],
    );

    const renameContainer = useCallback(
        (containerId: SiteContainerId, label: string) => {
            const rpcPromise = updateSiteContainerLabel(context, {siteId, id: containerId, label});

            updateTreeOptimistically(
                rpcPromise.then(result => handleEventForSite(result.events)),
                (oldTree, promiseValue) => {
                    // If promise value is defined, that means rpcPromise resolved and
                    // handleEventForSite() has run. Since handleEventForSite() will incorporate the
                    // update into our store we can simply return oldTree from here as an optimization.
                    if (promiseValue !== undefined) {
                        return oldTree;
                    }

                    return oldTree.updateEntry(containerId, entry => ({...entry, label}));
                },
            );
        },
        [context, handleEventForSite, siteId, updateTreeOptimistically],
    );

    const renameSite = useCallback(
        async (name: string): Promise<void> => {
            const rpcPromise = updateSiteName(context, {siteId, name});

            updateTreeOptimistically(
                rpcPromise.then(result => handleEventForSite([result.events])),
                (oldTree, promiseValue) => {
                    // If promise value is defined, that means rpcPromise resolved and
                    // handleEventForSite() has run. Since handleEventForSite() will incorporate the
                    // update into our store we can simply return oldTree from here as an optimization.
                    if (promiseValue !== undefined) {
                        return oldTree;
                    }

                    return oldTree.updateSite(site => ({...site, name}));
                },
            );

            // Surface RPC failures to the caller so editors can keep the user in edit mode and
            // report the error. The optimistic update has already reverted by the time this
            // promise rejects — we don't have to undo anything here.
            await rpcPromise;
        },
        [context, handleEventForSite, siteId, updateTreeOptimistically],
    );

    /**
     * Remove an entity from the site and return the closest remaining entity to
     * navigate to — the previous entity in DFS pre-order, or the next entity if no
     * predecessor exists, or null if the site has no entities left.
     */
    const removeEntity = useCallback(
        async (entityId: SiteItemSearchEntityId): Promise<void> => {
            const adjacentEntityId = computeAdjacentEntityId(entityId, tree);

            // If a user removes an entity that they are not currently looking at, it's fine to
            // remove it as quickly as possible. We don't need to navigate to another entity.
            if (activeState.activeEntityId !== entityId) {
                const rpcPromise = removeEntityFromSite(context, {
                    siteId,
                    spaceId: space.id,
                    entityId,
                });
                updateTreeOptimistically(
                    rpcPromise.then(result => handleEventForSite(result.events)),
                    (oldTree, promiseValue) => {
                        // If promise value is defined, that means rpcPromise resolved and
                        // handleEventForSite() has run. Since handleEventForSite() will incorporate the
                        // update into our store we can simply return oldTree from here as an optimization.
                        if (promiseValue !== undefined) {
                            return oldTree;
                        }

                        // It's possible that the realtime service broadcasted the removal back to the
                        // client before the promise resolves. In that case, the entry wil no longer exist
                        // in the tree.
                        if (oldTree.getEntryIfExists(entityId) === undefined) {
                            return oldTree;
                        }

                        return oldTree.deleteEntry(entityId);
                    },
                );
                return;
            }

            // NOTE(ifitzsimmons, @#pause-site-realtime-events): We're removing the entity
            // that's currently loaded, so we need to navigate to the next entity once the
            // current entity is removed.
            //
            // However, there are race conitions aplenty that we need to consider. When we fire
            // off the RPC request, two things happen somewhat simultaneously:
            //
            // 1. The rpc runs and returns the event transaction, which we broadcast to the
            //    realtime query.
            // 2. As soon as the entity is removed at the DB layer, it sends the event to the
            //    realtime query via the WebSocket.
            //
            // If (2) wins out, then the site tree in context will be updated with the removal
            // of the current entity. This would cause a flicker on the screen, because when we
            // look for the current entity in the tree in `useSiteChromeContainer`, we don't
            // find it. Since we don't find it, we won't render the site chrome. What the user
            // sees is a brief paint of the current entity without the site chrome, and then
            // they see the site pop back onto the screen for the next entity after (1)
            // resolves and navigation completes.
            //
            // To avoid this, we pause the realtime subsription, so that even if (2) wins out,
            // the event will be queued and applied to the tree after (1) resolves.
            await withPausedRealtimeEvents(async () => {
                const {events} = await removeEntityFromSite(context, {
                    siteId,
                    spaceId: space.id,
                    entityId,
                });

                await navigateWithinSite(
                    adjacentEntityId
                        ? getSearchDynamicEntityPathFromEntityIdObject(
                              space.id,
                              parseSiteItemSearchEntityId(adjacentEntityId),
                              routeLayout,
                          )
                        : `/site/${siteId}`,
                );
                flushSync(() => handleEventForSite(events));
            });
        },
        [
            tree,
            activeState.activeEntityId,
            withPausedRealtimeEvents,
            context,
            siteId,
            space.id,
            updateTreeOptimistically,
            handleEventForSite,
            navigateWithinSite,
            routeLayout,
        ],
    );

    /**
     * Move an entry (entity or section) to a new position, optionally in a different
     * parent container. Applies an optimistic update and fires the `moveSiteEntry`
     * RPC.
     */
    const moveEntry = useCallback(
        (entry: MoveSiteEntryInput) => {
            if (
                isSiteSideBarSectionContainerId(entry.id) &&
                doesSiteEntryMoveIntroduceCycle(entry.id, entry.newPosition.parentId, tree)
            ) {
                // If a section has children and a user drags the section into its current place,
                // the drag target may think that the user is attempting to drag the section within
                // itself. What the user is actually doing though, is moving the item back to its
                // original place. In this case, we should no-op
                return;
            }

            const oldEntry = tree.getEntry(entry.id);
            assert(oldEntry.parentId !== null);

            if (
                oldEntry.parentId === entry.newPosition.parentId &&
                oldEntry.orderKey === entry.newPosition.orderKey
            ) {
                // noop if the entry was dragged back to original position
                return;
            }

            updateTreeOptimistically(
                moveSiteEntry(context, {
                    siteId,
                    item: createMoveSiteEntryItem(entry),
                }).then(result => handleEventForSite(result.events)),
                (oldTree, promiseValue) => {
                    // If promise value is defined, that means rpcPromise resolved and
                    // handleEventForSite() has run. Since handleEventForSite() will incorporate the
                    // update into our store we can simply return oldTree from here as an optimization.
                    if (promiseValue !== undefined) {
                        return oldTree;
                    }

                    return oldTree.updateEntry(entry.id, oldEntry =>
                        mergeNewSitePositionIntoSiteEntry(oldEntry, entry.newPosition),
                    );
                },
            );
        },
        [context, handleEventForSite, siteId, tree, updateTreeOptimistically],
    );

    /**
     * Create a new document, add it to the site at the given position, and navigate to
     * it. Both the document creation and site-add RPCs are awaited before navigating —
     * see the NOTE on `addEntity` above for why.
     */
    const createDocumentInSite = useCallback(
        async ({parentId, orderKey}: {parentId: SiteContainerId; orderKey: OrderKey}) => {
            const documentId = generateId<DocumentId>();

            // NOTE(ifitzsimmons, #pause-site-realtime-events): Without pausing the realtime
            // events, the document may appear in the site chrome before we navigate to it.
            await withPausedRealtimeEvents(async () => {
                const {eventsForSite} = await createDocument(context, {
                    spaceId: space.id,
                    documentId,
                    sitePosition: {siteId, parentId, orderKey},
                });

                await navigateWithinSite(`/doc/${documentId}`);
                flushSync(() => handleEventForSite(eventsForSite));
            });
        },
        [
            withPausedRealtimeEvents,
            context,
            handleEventForSite,
            navigateWithinSite,
            space.id,
            siteId,
        ],
    );

    const createTaskInSite = useCallback(
        async ({parentId, orderKey}: {parentId: SiteContainerId; orderKey: OrderKey}) => {
            const taskId = generateId<TaskId>();

            // NOTE(ifitzsimmons, #pause-site-realtime-events): Without pausing the realtime
            // events, the task may appear in the site chrome before we navigate to it.
            await withPausedRealtimeEvents(async () => {
                const {eventsForSite} = await commitTaskActionTransaction(context, {
                    spaceId: space.id,
                    clientId: null,
                    actions: [
                        {
                            type: "UpdateTask",
                            time: [Date.now(), 0],
                            taskId,
                            taskAction: {
                                type: "Create",
                                creator: {accountId: assertExists(currentAccount).id, from: null},
                                creatorTimeZone: clientInfo.timeZone,
                            },
                        },
                        {
                            type: "UpdateTask",
                            time: [Date.now(), 0],
                            taskId,
                            taskAction: {
                                type: "UpdateAccessPolicy",
                                accessPolicy: {
                                    type: "Site",
                                    siteId,
                                    position: {
                                        parentId,
                                        orderKey,
                                    },
                                },
                            },
                        },
                    ],
                });

                await navigateWithinSite(`/task/${taskId}`);
                if (eventsForSite) {
                    flushSync(() => handleEventForSite(eventsForSite));
                }
            });
        },
        [
            withPausedRealtimeEvents,
            context,
            space.id,
            currentAccount,
            clientInfo.timeZone,
            siteId,
            handleEventForSite,
            navigateWithinSite,
        ],
    );

    const createChannelInSite = useCallback(
        async ({parentId, orderKey}: {parentId: SiteContainerId; orderKey: OrderKey}) => {
            const channelId = generateId<ChannelId>();

            // NOTE(ifitzsimmons, #pause-site-realtime-events): Without pausing the realtime
            // events, the channel may appear in the site chrome before we navigate to it.
            await withPausedRealtimeEvents(async () => {
                const {eventsForSite} = await createChannel(context, {
                    spaceId: space.id,
                    channelId,
                    name: "Untitled channel",
                    accessPolicy: {type: "Site", siteId, position: {parentId, orderKey}},
                });

                await navigateWithinSite(`/channel/${channelId}`);

                flushSync(() => handleEventForSite(eventsForSite));
            });
        },
        [
            withPausedRealtimeEvents,
            context,
            handleEventForSite,
            navigateWithinSite,
            space.id,
            siteId,
        ],
    );

    const createTaskCollectionInSite = useCallback(
        async ({parentId, orderKey}: {parentId: SiteContainerId; orderKey: OrderKey}) => {
            const collectionId = generateId<TaskCollectionId>();

            // NOTE(ifitzsimmons, #pause-site-realtime-events): Without pausing the realtime
            // events, the task collection may appear in the site chrome before we navigate to
            // it.
            await withPausedRealtimeEvents(async () => {
                const {eventsForSite} = await commitTaskActionTransaction(context, {
                    spaceId: space.id,
                    clientId: null,
                    actions: [
                        {
                            type: "UpdateCollection",
                            time: [Date.now(), 0],
                            collectionId,
                            collectionAction: {
                                type: "Create",
                                creator: {accountId: assertExists(currentAccount).id, from: null},
                                name: "Untitled collection",
                                accessPolicy: {
                                    type: "Site",
                                    siteId,
                                    position: {
                                        parentId,
                                        orderKey,
                                    },
                                },
                            },
                        },
                    ],
                });

                await navigateWithinSite(`/task-collection/${collectionId}`);
                if (eventsForSite) {
                    flushSync(() => handleEventForSite(eventsForSite));
                }
            });
        },
        [
            withPausedRealtimeEvents,
            context,
            space.id,
            currentAccount,
            siteId,
            handleEventForSite,
            navigateWithinSite,
        ],
    );

    return {
        addMultipleEntities,
        createSidebarSection,
        deleteContainer,
        renameContainer,
        renameSite,
        removeEntity,
        moveEntry,
        addEntity,
        createDocumentInSite,
        createTaskInSite,
        createChannelInSite,
        createTaskCollectionInSite,
    };
}

type MoveSiteEntryInput =
    | {
          id: SiteSideBarSectionContainerId;
          newPosition: {
              parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
              orderKey: OrderKey;
          };
      }
    | {
          id: SiteItemSearchEntityId;
          newPosition: {
              parentId: SiteContainerId;
              orderKey: OrderKey;
          };
      };
function createMoveSiteEntryItem(entry: MoveSiteEntryInput):
    | {
          type: "SideBarSection";
          id: SiteSideBarSectionId;
          newPosition: {
              parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
              orderKey: OrderKey;
          };
      }
    | {
          type: "Entity";
          id: SiteItemSearchEntityId;
          newPosition: {
              parentId: SiteContainerId;
              orderKey: OrderKey;
          };
      } {
    const idObject = isSiteItemSearchEntityId(entry.id)
        ? ({type: "Entity", id: entry.id} as const)
        : parseSiteSideBarSectionContainerId(entry.id);

    const newParentId = entry.newPosition.parentId;

    switch (idObject.type) {
        case "Entity": {
            return {type: "Entity", id: idObject.id, newPosition: entry.newPosition};
        }
        case "SideBarSection": {
            assert(
                isSiteSideBarSectionContainerId(newParentId) ||
                    isSiteSideBarContainerId(newParentId),
            );
            return {
                type: "SideBarSection",
                id: idObject.id,
                newPosition: {parentId: newParentId, orderKey: entry.newPosition.orderKey},
            };
        }
        default:
            throw exhaustive(idObject);
    }
}
