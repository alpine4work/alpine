/* eslint-disable react-refresh/only-export-components */
import {useMatches} from "@remix-run/react";
import {Memo, ReactNode, createContext, useCallback, useContext, useMemo, useRef} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useRynamoQuery} from "~/client/web/dynamo/use_rynamo_query.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {getLoaderDataWithSchema} from "~/client/web/remix/get_loader_data_with_schema.js";
import {useSiteRegistry} from "~/client/web/sites/context/site_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {RynamoEvent, RynamoQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {siteLoaderDataKey} from "~/shared/remix/json_with_schema_shared.js";
import {SiteLoaderData, SiteLoaderDataSchema} from "~/shared/remix/site_loader_data.js";
import {backfillSite, getSite} from "~/shared/rpc/sites_rpc_definitions.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";
import {
    SiteEntryModel,
    SiteOrSiteEntryModel,
    SitePreviewModel,
    SitePreviewModelData,
    SiteSideBarModel,
    SiteTopBarModel,
} from "~/shared/sites/site_model.js";
import {SiteRealtimeProtocol} from "~/shared/sites/site_realtime_protocol.js";
import {SiteTreeBase} from "~/shared/sites/site_tree_base.js";
import {Store} from "~/shared/store/store.js";

/**
 * Active state for a site (which sidebar/sections are active/expanded).
 */
export type SiteActiveState = {
    readonly activeEntityId: SiteItemSearchEntityId | null;
    readonly activeSideBarId: SiteContainerId | null;
};

// =============================================================================
// Activation context manages which site (if any) is active at the space level
//
// ## How activation works
//
// `SiteProvider` (below) is mounted once at the space level. It calls Remix's
// `useMatches()` to read the current route tree's loader data and searches for a
// known entity-route whose loader returned a `siteLoaderDataKey` field. If found,
// that `siteLoaderDataKey` is deserialized via schema and used to derive the
// provider's `activation` state, which in turn mounts `ActiveSiteDataProvider`
// with the site's initial realtime query result.
//
// Crucially, this happens synchronously during `SiteProvider`'s own render (no
// `useEffect`). So `ActiveSiteDataProvider` mounts on the first render, the full
// `SiteDataContext` is populated on the first render, and site chrome renders on
// the first paint (including SSR hydration).
//
// ## Why `SiteProvider` lives at the space level (and not inside entity routes)
//
// Chrome components (`SiteSideBar`, `SiteTopBar`, their descendants) depend on a
// rich `SiteDataContext` that includes the site's realtime query, the derived
// tree, optimistic update functions, active-entity state, etc. That context is
// produced by `ActiveSiteDataProvider`, which in turn owns:
//
// - a WebSocket connection to the site's realtime durable object
// - the `useRynamoQuery` hook tracking server state
// - the `useStateWithOptimisticUpdates` state tracking pending-RPC overlays
//
// If we mounted `ActiveSiteDataProvider` _inside_ the entity route (e.g. from
// `useSiteChromeContainer`), navigating from one entity to another in the same
// site would unmount and remount it. That would: tear down and reopen the
// WebSocket, reset the realtime query state, and, worst of all, drop any in-flight
// optimistic updates. A user who just added an entity from the modal and navigated
// to it would see the site tree briefly revert until the server round-trip
// completes and the fresh state streams back.
//
// Keeping the provider above the entity routes means the same provider instance
// services every entity within a site. Navigation just re-renders the child
// subtree; the realtime connection and optimistic state survive.
//
// ## Why `useMatches` instead of a callback from child routes
//
// The earlier design had entity routes call an `activateSite(siteId, data)`
// callback from a `useEffect`. The problem there is that `useEffect` runs _after_
// the first render commits, so the first paint never had the site chrome. There
// was a very visible flicker until the effect fired and the provider re-rendered.
//
// We explored fixing the flash in several ways before settling on this one:
//
// 1. Move `activateSite` out of `useEffect` and call it during render. Fails:
//    child components cannot call setState on a parent during the parent's render.
//    React warns, and the provider doesn't re-render before commit anyway, so the
//    flicker persists.
//
// 2. Route the activation through an external store + `useSyncExternalStore` so
//    children could imperatively mutate provider state during render. Cleaner than
//    (1) but still subject to parent-vs-child render ordering: the store mutation
//    happens during the child's render, after the parent already rendered with
//    `activation: null`. Still flickers.
//
// 3. Have `useSiteChromeContainer` build a fallback tree from the loader's
//    `initialQueryResult` for the first render, then switch to the provider's tree
//    once it activates. Fails because chrome components need the full
//    `SiteDataContext` (not just a tree) - they call `useSite`,
//    `useCanManageSite`, `useSiteChildren`, etc., which throw when the context
//    isn't provided.
//
// 4. Mount `ActiveSiteDataProvider` inside `useSiteChromeContainer` or the entity
//    route. Renders chrome on first paint, but loses cross-navigation persistence
//    as described above.
//
// `useMatches` fixes the flash without any of those tradeoffs: the provider is a
// _parent_ of the entity route, but it can still read the entity route's loader
// data synchronously because `useMatches` exposes the full matched tree. Parent
// renders first, sees the child's data, activates, then renders children with the
// context already populated.
//
// ## Implications for nested routes
//
// Two things that look similar behave differently:
//
// - **Site activation** (the provider's `SiteDataContext` being populated) is
//   driven by `useMatches` finding `siteLoaderDataKey` _anywhere_ in the matched
//   route tree. Any route nested under a route that returns `siteLoaderDataKey`
//   automatically inherits site activation - `useSite`, `useSiteTree`,
//   `useCanManageSite`, etc. all work in those children without extra wiring.
//
// - **Site chrome rendering** (actually wrapping content in sidebars/topbars) is
//   opt-in: a route explicitly calls `useSiteChromeContainer` to render chrome.
//
// This split is intentional. If you introduce a parent layout route (say
// `s.$spaceId.documents.$documentId.tsx` with child routes for the document view,
// comments, a print view, etc.) the layout author picks one of two patterns:
//
// 1. Wrap `<Outlet />` in `useSiteChromeContainer` inside the layout. Every child
//    renders inside the chrome. Children _cannot_ escape. Good when chrome should
//    be consistent across all child views of an entity (usual case).
//
// 2. Render `<Outlet />` raw. Each child route calls `useSiteChromeContainer`
//    itself, or not. Good when some children (e.g. a full-screen print/present
//    view) should render without chrome.
//
// In either case, child routes are inside an active site context, but they choose
// whether to render the site chrome or not. That decoupling is a feature: a
// presentation mode can still read the site tree for navigation without forcing
// the chrome frame onto the screen.
//
// ## Downsides we accept
//
// - **Coupling of routes to the activation list.** Every entity route that should
//   mount inside site chrome must return `siteLoaderDataKey` in its loader, and
//   must be listed in `siteActivationRouteIds` below. This is decoupled from
//   `useSiteChromeContainer` \u2014 a new route author has to remember to update
//   both places. We mitigate this by keeping the list short and co-located with
//   the provider.
//
// - **O(n) scan of matches on every `SiteProvider` render.** In practice n is ~3
//   (root, space layout, leaf route), so this is cheap. If the list grows or a hot
//   code path re-renders the provider often we can memoize, but measurement comes
//   before premature optimization.
//
// - **Loader schema coupling.** `siteLoaderDataKey` is deserialized with a schema
//   defined in this file, so entity route loaders must return `siteLoaderDataKey`
//   in exactly the shape this schema expects. Deviating (or wrapping in a
//   different field) silently breaks activation. We've guarded against this by
//   adding a `siteLoaderData` property to `jsonWithSchema()`.
//   =============================================================================

type SiteActivationState = {
    readonly site: {
        readonly siteId: SiteId;
        readonly initialQueryResult: RynamoQueryResult<SiteOrSiteEntryModel>;
    };
    readonly activeEntityId: SiteItemSearchEntityId | null;
};

type SiteActivationContextValue = {
    /** The currently active site ID, if any. */
    readonly activeSiteId: SiteId | null;
};

const SiteActivationContext = createContext<SiteActivationContextValue | null>(null);

export function useSiteActivation(): SiteActivationContextValue {
    const context = useContext(SiteActivationContext);
    if (!context) {
        throw new InternalError("useSiteActivation must be used within a SiteProvider");
    }
    return context;
}

function findSiteLoaderDataInMatches(
    matches: ReadonlyArray<{readonly id: string; readonly data: unknown}>,
): SiteLoaderData | null {
    for (const match of matches) {
        const loaderData = match.data as SchemaSerializedValue;
        if (!isPlainObject(loaderData)) continue;

        const siteLoaderDataSerializedValue = loaderData[siteLoaderDataKey];
        if (!siteLoaderDataSerializedValue) continue;

        return getLoaderDataWithSchema(SiteLoaderDataSchema, siteLoaderDataSerializedValue);
    }
    return null;
}

/**
 * Decide what activation state to hold given the loader data on the current
 * matched routes and the activation we already have.
 *
 * - `null` from the loader: no site on this route — clear activation.
 * - `UseNewSite`: server returned a query result; adopt it. If we already have an
 *   activation for the same site we keep the existing reference so
 *   `ActiveSiteDataProvider` doesn't reset its WebSocket / optimistic state.
 * - `UseActiveSite`: client signaled (via `?siteFromCache=...`) that it already
 *   has the site cached, so the loader skipped the fetch. Keep current activation
 *   when siteIds match. If they don't match (or there is no current activation)
 *   throw — the cache hint is only emitted by within-app navigation that already
 *   has the site loaded, so a mismatch indicates a programming error.
 */
function computeNextActivation(
    siteData: SiteLoaderData | null,
    current: SiteActivationState | null,
): SiteActivationState | null {
    if (siteData === null) return null;

    switch (siteData.type) {
        case "UseNewSite":
            if (current?.site.siteId === siteData.siteId) {
                if (current.activeEntityId === siteData.activeEntityId) return current;

                return {
                    site: current.site,
                    activeEntityId: siteData.activeEntityId,
                };
            }

            return {
                site: {
                    siteId: siteData.siteId,
                    initialQueryResult: siteData.initialQueryResult,
                },
                activeEntityId: siteData.activeEntityId,
            };
        case "UseActiveSite":
            if (current?.site.siteId !== siteData.siteId) {
                throw new InternalError("Site ID mismatch");
            }

            if (current.activeEntityId === siteData.activeEntityId) return current;

            return {
                site: current.site,
                activeEntityId: siteData.activeEntityId,
            };
        default:
            throw exhaustive(siteData);
    }
}

type SiteTreeForClient = SiteTreeBase<SiteEntryModel>;

type SiteDataContextValue = {
    readonly siteId: SiteId;
    readonly tree: SiteTreeForClient;
    readonly activeState: SiteActiveState;
    readonly handleEventForSite: Memo<
        (events: ReadonlyArray<RynamoEvent<SiteOrSiteEntryModel>>) => void
    >;

    readonly updateTreeOptimistically: Memo<
        <PromiseValue>(
            promise: Promise<PromiseValue>,
            update: (
                tree: SiteTreeForClient,
                promiseValue: PromiseValue | undefined,
            ) => SiteTreeForClient,
        ) => void
    >;

    /**
     * Run `fn` with the realtime event subscription paused. Incoming WebSocket events
     * are queued instead of being applied to the tree until `fn` resolves (or throws),
     * at which point the queue flushes and normal delivery resumes.
     *
     * NOTE(ifitzsimmons, #pause-site-realtime-events): This is a utility function that
     * allows you to pause the realtime event subscription for a given function. This
     * is useful when you want to perform an operation that should not be affected by
     * realtime events. It will only flush the queue when all pausers have released.
     *
     * For more on this, you can find the parent comment using the
     * pause-site-realtime-events tag, where the parent comment is prepended by 2 #'s
     */
    readonly withPausedRealtimeEvents: Memo<<T>(fn: () => Promise<T>) => Promise<T>>;
};

const SiteDataContext = createContext<SiteDataContextValue | null>(null);

/**
 * Space-level site provider. Derives the active site synchronously from the
 * current matched routes' loader data via `useMatches`. This means
 * `ActiveSiteDataProvider` mounts on the first render (no `useEffect` round-trip)
 * and chrome renders on the first paint — no flash.
 *
 * Cross-navigation persistence: when navigating between entities in the same site,
 * `siteId` is unchanged, so `activation` stays the same reference and
 * `ActiveSiteDataProvider` does not re-initialize. This preserves the realtime
 * WebSocket and any in-flight optimistic state.
 */
export function SiteProvider({children}: {readonly children: ReactNode}) {
    const matches = useMatches();
    const siteLoaderData = useMemo(() => findSiteLoaderDataInMatches(matches), [matches]);

    const activation = useStateWithDependenciesWithoutDispatch<
        SiteActivationState | null,
        [SiteLoaderData | null]
    >(
        ([siteLoaderData], previousActivation) =>
            computeNextActivation(siteLoaderData, previousActivation ?? null),
        [siteLoaderData],
    );

    const activationContextValue = useMemo(
        (): SiteActivationContextValue => ({
            activeSiteId: activation?.site.siteId ?? null,
        }),
        [activation?.site.siteId],
    );

    return (
        <SiteActivationContext.Provider value={activationContextValue}>
            {activation ? (
                <ActiveSiteDataProvider
                    siteId={activation.site.siteId}
                    initialQueryResult={activation.site.initialQueryResult}
                    activeEntityId={activation.activeEntityId}
                >
                    {children}
                </ActiveSiteDataProvider>
            ) : (
                children
            )}
        </SiteActivationContext.Provider>
    );
}

// =============================================================================
// ActiveSiteDataProvider - only mounted when a site is active
// =============================================================================
function ActiveSiteDataProvider({
    siteId,
    initialQueryResult,
    activeEntityId,
    children,
}: {
    readonly siteId: SiteId;
    readonly initialQueryResult: RynamoQueryResult<SiteOrSiteEntryModel>;
    readonly activeEntityId: SiteItemSearchEntityId | null;
    readonly children: ReactNode;
}) {
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const siteRegistry = useSiteRegistry();

    const shouldConnectToRealtime = currentAccount !== null;

    const {isConnected, subscribeToEvents, subscribeToPongs} = useWebSocket(
        "SiteRealtimeService",
        SiteRealtimeProtocol,
        shouldConnectToRealtime ? `/api/durable-objects/sites/${siteId}` : null,
    );

    // Counter (not boolean) so concurrent pauses compose. The queue holds raw
    // event-transactions whose delivery to the realtime query was deferred while
    // paused; they're replayed in arrival order on resume once the counter hits zero.
    // Queue is lazily allocated — the common case (no pauses, or no events arriving
    // during a pause) doesn't pay for an array.
    const pauseCountRef = useRef(0);
    const pausedEventQueueRef = useRef<Array<
        ReadonlyArray<RynamoEvent<SiteOrSiteEntryModel>>
    > | null>(null);

    const {query, handleEvent: handleEventForSite} = useRynamoQuery(initialQueryResult, {
        isConnected,
        subscribeToPongs,
        subscribeToEvents: useCallback(
            subscriber =>
                subscribeToEvents(event => {
                    if (pauseCountRef.current > 0) {
                        (pausedEventQueueRef.current ??= []).push(event.events);
                        return;
                    }
                    subscriber(event.events);
                }),
            [subscribeToEvents],
        ),
        backfillQuery: useCallback(
            async checkpoint => {
                const {backfillResult} = await backfillSite(context, {
                    siteId,
                    checkpoint,
                });
                return backfillResult;
            },
            [context, siteId],
        ),
        reloadQuery: useCallback(async () => {
            const {siteResult} = await getSite(context, {siteId});
            return siteResult;
        }, [context, siteId]),
    });

    // Derive server-authoritative site + entries from the realtime query
    const queryDerived = useMemo(() => {
        let siteStore: Store<SitePreviewModelData> | null = null;
        const entryModels: Array<SiteEntryModel> = [];

        const itemCount = query.getItemCountWithoutLoadingIndicator();
        for (let i = 0; i < itemCount; i++) {
            const queryItem = query.getItem(i);
            if (queryItem.type !== "Loaded") continue;

            const model = queryItem.item.model;
            if (model instanceof SitePreviewModel) {
                assert(siteStore === null);
                siteStore = siteRegistry.getSiteStore(model);
            } else {
                entryModels.push(model);
            }
        }

        return {siteStore: assertExists(siteStore), entries: entryModels};
    }, [query, siteRegistry]);

    const site = useStore(queryDerived.siteStore);
    const entries = queryDerived.entries;

    const [originalTreeState, updateTreeState, updateTreeStateOptimistically] =
        useStateWithOptimisticUpdates(() => ({
            site,
            entries,
            tree: SiteTreeBase.fromEntries(site, entries),
        }));

    let treeState = originalTreeState;

    if (site !== treeState.site || entries !== treeState.entries) {
        if (site !== treeState.site && entries !== treeState.entries) {
            treeState = {
                site,
                entries,
                tree: SiteTreeBase.fromEntries(site, entries),
            };
        } else if (site !== treeState.site) {
            treeState = {
                site,
                entries,
                tree: treeState.tree.copyTreeWithNewSite(site),
            };
        } else {
            assert(entries !== treeState.entries);

            treeState = {
                site,
                entries,
                tree: treeState.tree.copyTreeWithNewEntries(entries),
            };
        }
        updateTreeState(() => treeState);
    }

    const {tree} = treeState;

    const updateTreeOptimistically = useCallback(
        function <PromiseValue>(
            promise: Promise<PromiseValue>,
            update: (
                tree: SiteTreeForClient,
                promiseValue: PromiseValue | undefined,
            ) => SiteTreeForClient,
        ) {
            updateTreeStateOptimistically(promise, (treeState, promiseValue) => {
                const newTree = update(treeState.tree, promiseValue);
                if (newTree === treeState.tree) return treeState;
                return {...treeState, tree: newTree};
            });
        },
        [updateTreeStateOptimistically],
    );

    const activeState = useMemo((): SiteActiveState => {
        if (!activeEntityId) {
            return {activeEntityId: null, activeSideBarId: null};
        }

        const chrome = findSiteChrome(tree, activeEntityId);
        const activeSideBarId = chrome.sidebar ? chrome.sidebar.id : null;

        return {activeEntityId, activeSideBarId};
    }, [activeEntityId, tree]);

    const withPausedRealtimeEvents = useCallback(
        async function <Value>(action: () => Promise<Value>): Promise<Value> {
            pauseCountRef.current += 1;
            try {
                return await action();
            } finally {
                // Only flush when the outermost pauser releases — a nested pauser shouldn't drain
                // the outer one's queue prematurely.
                pauseCountRef.current -= 1;
                if (pauseCountRef.current === 0) {
                    const queued = pausedEventQueueRef.current;
                    pausedEventQueueRef.current = null;
                    if (queued) {
                        for (const events of queued) {
                            handleEventForSite(events);
                        }
                    }
                }
            }
        },
        [handleEventForSite],
    );

    const contextValue = useMemo(
        (): SiteDataContextValue => ({
            siteId,
            tree,
            activeState,
            updateTreeOptimistically,
            handleEventForSite,
            withPausedRealtimeEvents,
        }),
        [
            siteId,
            tree,
            activeState,
            updateTreeOptimistically,
            handleEventForSite,
            withPausedRealtimeEvents,
        ],
    );

    return <SiteDataContext.Provider value={contextValue}>{children}</SiteDataContext.Provider>;
}

/**
 * Access the active site's data context. Throws if no site is active.
 */
export function useSiteContext(): SiteDataContextValue {
    const context = useContext(SiteDataContext);
    if (!context) {
        throw new InternalError("useSiteContext must be used when a site is active");
    }
    return context;
}

/**
 * Access the active site's data context, or null if no site is active.
 */
export function useSiteContextIfExists(): SiteDataContextValue | null {
    return useContext(SiteDataContext);
}

export function useSite(): SitePreviewModelData | null {
    const {tree} = useSiteContext();

    // The tree always contains the site value from the store, so we can return it
    // directly here.
    return tree.site;
}

export function useSiteActiveState(): SiteActiveState {
    const {activeState} = useSiteContext();
    return activeState;
}

export function useSiteTree(): SiteTreeForClient {
    const {tree} = useSiteContext();
    return tree;
}

export function useSiteChrome(entityId: SiteItemSearchEntityId | null): {
    readonly sidebar: SiteSideBarModel | null;
    readonly topbar: SiteTopBarModel | null;
} {
    const {tree} = useSiteContext();

    return useMemo(() => {
        if (!entityId) {
            return {sidebar: null, topbar: null};
        }
        return findSiteChrome(tree, entityId);
    }, [tree, entityId]);
}

/**
 * Whether the current account has manage access on the active site. Returns false
 * when the site hasn't loaded yet or the user is anonymous.
 */
export function useCanManageSite(): boolean {
    const site = useSite();
    const {currentAccount} = useSpaceContext();

    return useMemo(() => {
        if (!site || !currentAccount) return false;
        const level = getAccountAccessLevelAssumingSpaceAccess(
            site.accessPolicy,
            currentAccount.id,
        );
        return hasAccessLevel(level, "Manage");
    }, [site, currentAccount]);
}

/**
 * Find the chrome (sidebar and topbar) for a given entity.
 *
 * Walks up the parent chain from the Entity matching the entityId to find the
 * nearest SideBar and/or TopBar.
 */
function findSiteChrome(
    tree: SiteTreeForClient,
    entityId: SiteItemSearchEntityId,
): {
    readonly sidebar: SiteSideBarModel | null;
    readonly topbar: SiteTopBarModel | null;
} {
    const entityEntry = tree.entryById.get(entityId);
    if (!entityEntry) return {sidebar: null, topbar: null};

    let currentParentId: SiteContainerId | null = entityEntry.parentId;

    while (currentParentId !== null) {
        const parentEntry = tree.getEntry(currentParentId);

        switch (parentEntry.type) {
            case "SideBarSection":
                currentParentId = parentEntry.parentId;
                break;
            case "SideBar": {
                const sideBarParent = parentEntry.parentId
                    ? tree.getEntry(parentEntry.parentId)
                    : null;
                if (sideBarParent?.type === "TopBar") {
                    return {sidebar: parentEntry, topbar: sideBarParent};
                }
                return {sidebar: parentEntry, topbar: null};
            }
            case "TopBar": {
                const topBarChildren = tree.getChildrenForParent(parentEntry.id);
                const sideBarChild = topBarChildren.find(child => child.type === "SideBar");
                if (sideBarChild?.type === "SideBar") {
                    return {sidebar: sideBarChild, topbar: parentEntry};
                }
                return {sidebar: null, topbar: parentEntry};
            }
            case "Entity":
                throw new FailedPreconditionError("Entities cannot be parents");
            default:
                throw exhaustive(parentEntry);
        }
    }

    return {sidebar: null, topbar: null};
}
