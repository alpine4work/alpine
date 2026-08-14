/* eslint-disable react-refresh/only-export-components */
import {useMatches} from "@remix-run/react";
import {Memo, ReactNode, createContext, useCallback, useContext, useMemo, useRef} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {useRynamoQuery} from "~/client/web/dynamo/use_rynamo_query.js";
import {
    useStateWithDependencies,
    useStateWithDependenciesWithoutDispatch,
} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {usePromise} from "~/client/web/helpers/use_promise.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {getLoaderDataWithSchema} from "~/client/web/remix/get_loader_data_with_schema.js";
import {isLoadingIndicatorLoaderData} from "~/client/web/remix/loading_indicator_loader_data.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {useSiteRegistry} from "~/client/web/sites/context/site_registry_context.js";
import {
    CollapsedSectionsState,
    isSectionCollapsed,
} from "~/client/web/sites/helpers/site_side_bar_collapsed_section_state.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {RynamoEvent, RynamoQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.open_source.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {siteLoaderDataKey} from "~/shared/remix/json_with_schema_shared.js";
import {SiteLoaderData, SiteLoaderDataSchema} from "~/shared/remix/site_loader_data.js";
import {backfillSite, getSite} from "~/shared/rpc/sites_rpc_definitions.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {SiteContainerId, SiteSideBarSectionContainerId} from "~/shared/sites/site_entry_id.js";
import {
    SiteEntryModel,
    SiteOrSiteEntryModel,
    SitePreviewModel,
    SitePreviewModelData,
    SiteSideBarModel,
    SiteSideBarSectionModel,
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
// If we mounted `ActiveSiteDataProvider` _inside_ the entity route, navigating
// from one entity to another in the same site would unmount and remount it. That
// would: tear down and reopen the WebSocket, reset the realtime query state, and,
// worst of all, drop any in-flight optimistic updates. A user who just added an
// entity from the modal and navigated to it would see the site tree briefly revert
// until the server round-trip completes and the fresh state streams back.
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
// 3. Have `SiteChromeContainer` build a fallback tree from the loader's
//    `initialQueryResult` for the first render, then switch to the provider's tree
//    once it activates. Fails because chrome components need the full
//    `SiteDataContext` (not just a tree) - they call `useSite`,
//    `useCanManageSite`, `useSiteChildren`, etc., which throw when the context
//    isn't provided.
//
// 4. Mount `ActiveSiteDataProvider` inside `SiteChromeContainer` or the entity
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
//   handled once by `<SiteChromeContainer>` in the space layout, which wraps the
//   `<Outlet>` (and the loading-indicator shimmer). It reads the active entity
//   from this context and renders the chrome around it, so the chrome — and its
//   local state, like the sidebar's scroll position — stays mounted as you
//   navigate between entities in the same site. Individual entity routes don't
//   render their own chrome.
//
// This split is intentional. Activation rides on the loader data (any nested route
// inherits it), while the chrome frame is owned by the layout, above the
// `<Outlet>`. The tradeoff: a route can no longer opt out of chrome just by not
// calling a hook. If we ever need a full-screen view of a site entity without the
// frame (e.g. a present/print mode), it'll need an explicit signal — e.g. omitting
// `activeEntityId` from its loader data, or a nested layout route that renders its
// `<Outlet>` outside `<SiteChromeContainer>`.
//
// ## Downsides we accept
//
// - **Coupling of routes to the activation mechanism.** Every entity route that
//   should mount inside site chrome must return `siteLoaderDataKey` in its loader
//   (via `jsonWithSchema`'s `siteLoaderData` option) with the entity's
//   `activeEntityId`.
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

type SiteLoaderDataSource = {
    /**
     * The `siteLoaderData` available synchronously. Derived from a matched route's
     * deserialized loader data. While navigating within a site, we compute an
     * "optimistic" `siteLoaderData` based on the in-site navigation header and the
     * currently-loading entity id.
     */
    readonly immediate: SiteLoaderData | null;
    /**
     * Set when the matched route's data is a still-pending
     * `LoadingIndicatorLoaderData` wrapper. Subscribe to it to re-derive the real
     * `siteLoaderData` once it settles.
     */
    readonly pendingPromise: PromiseImmediate<unknown> | null;
};

/**
 * Scans the matched routes for the one that carries `siteLoaderData`, returning
 * the data available now plus (if that route is mid-navigation) the promise to
 * await for its real data.
 */
function findSiteLoaderDataSourceInMatches(
    matches: ReadonlyArray<{readonly id: string; readonly data: unknown}>,
): SiteLoaderDataSource {
    for (const match of matches) {
        const loaderData = match.data;

        // A navigation slower than the loading-indicator delay completes with
        // `LoadingIndicatorLoaderData` while the real loader data is still pending. Hand
        // back its promise (so the caller re-derives once it settles) and, meanwhile, its
        // synthesized `siteLoaderData` fallback (present for within-site navigations) so
        // the site stays active — destination entity highlighted — under the route
        // shimmer.
        if (isLoadingIndicatorLoaderData(loaderData)) {
            return {
                immediate: loaderData.siteLoaderData ?? null,
                pendingPromise: loaderData.promise,
            };
        }

        const siteLoaderData = parseSiteLoaderDataIfPossible(loaderData);
        if (siteLoaderData) return {immediate: siteLoaderData, pendingPromise: null};
    }
    return {immediate: null, pendingPromise: null};
}

/**
 * Reads and deserializes a route's `siteLoaderData`, or `null` if the loader data
 * isn't a plain object carrying the `siteLoaderDataKey`.
 */
function parseSiteLoaderDataIfPossible(loaderData: unknown): SiteLoaderData | null {
    // Cast first, then narrow with `isPlainObject` — narrowing the
    // `SchemaSerializedValue` union down to its object members is what makes indexing
    // by `siteLoaderDataKey` typecheck.
    const serializedValue = loaderData as SchemaSerializedValue;
    if (!isPlainObject(serializedValue)) return null;

    const siteLoaderDataSerializedValue = serializedValue[siteLoaderDataKey];
    if (!siteLoaderDataSerializedValue) return null;

    return getLoaderDataWithSchema(SiteLoaderDataSchema, siteLoaderDataSerializedValue);
}

/**
 * Decide what activation state to hold given the loader data on the current
 * matched routes and the activation we already have.
 *
 * - `null` from the loader: no site on this route — clear activation.
 * - `UseNewSite`: server returned a query result; adopt it. If we already have an
 *   activation for the same site we keep the existing reference so
 *   `ActiveSiteDataProvider` doesn't reset its WebSocket / optimistic state.
 * - `UseActiveSite`: client signaled (via the `cyberworlds-active-site-id` header)
 *   that it already has the site cached, so the loader skipped the fetch. This is
 *   also the variant synthesized on the client for a pending within-site
 *   navigation (see `getSiteLoaderDataForPendingNavigation`). Keep current
 *   activation when siteIds match. If they don't match (or there is no current
 *   activation) throw — the cache hint is only emitted by within-app navigation
 *   that already has the site loaded, so a mismatch indicates a programming error.
 */
function computeNextActivation(
    siteData: SiteLoaderData | null,
    current: SiteActivationState | null,
): SiteActivationState | null {
    if (siteData === null) return null;

    switch (siteData.type) {
        case "UseNewSite":
            if (current?.site.siteId === siteData.siteId) {
                if (current.activeEntityId === (siteData.activeEntityId ?? null)) return current;

                return {
                    site: current.site,
                    activeEntityId: siteData.activeEntityId ?? null,
                };
            }

            return {
                site: {
                    siteId: siteData.siteId,
                    initialQueryResult: siteData.initialQueryResult,
                },
                activeEntityId: siteData.activeEntityId ?? null,
            };
        case "UseActiveSite":
            if (current?.site.siteId !== siteData.siteId) {
                throw new InternalError("Site ID mismatch");
            }

            if (current.activeEntityId === siteData.activeEntityId) return current;

            return {
                site: current.site,
                activeEntityId: siteData.activeEntityId ?? null,
            };
        default:
            throw exhaustive(siteData);
    }
}

export type SiteTreeForClient = SiteTreeBase<SiteEntryModel>;

type SectionRow = {readonly depth: number; readonly entry: SiteSideBarSectionModel};

/**
 * Site-scoped sidebar UI state — what's collapsed, where to scroll on first paint.
 * Lives on the site context so it survives cross-leaf navigation within a site;
 * re-initializes when the active site changes via `useStateWithDependencies`.
 */
export type SiteSideBarState = {
    readonly collapsedSections: CollapsedSectionsState;
    readonly toggleSection: (row: SectionRow) => void;
    readonly expandSection: (row: SectionRow) => void;
    /**
     * Entity to scroll the sidebar to on first paint after activation. `null` once the
     * row has consumed it via `clearInitialScrollTarget`, or when there is no pending
     * scroll.
     */
    readonly initialScrollTargetEntityId: SiteItemSearchEntityId | null;
    readonly clearInitialScrollTarget: () => void;
};

export type SiteDataContextValue = {
    readonly siteId: SiteId;
    readonly tree: SiteTreeForClient;
    readonly activeState: SiteActiveState;
    readonly sideBarState: SiteSideBarState;
    /**
     * Menu action to favorite/unfavorite the site. Sourced from the site loader data
     * (the prefetcher fires `fetchIsFavorite` in parallel with `fetchSite`) so this is
     * available on the first paint of any entity route inside the site.
     */
    readonly favoriteSiteMenuAction: Memo<MenuAction> | null;
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

    const {immediate: immediateSiteLoaderData, pendingPromise} = useMemo(
        () => findSiteLoaderDataSourceInMatches(matches),
        [matches],
    );

    // A navigation slower than the loading-indicator delay resolves its real loader
    // data after the router state has already settled. We subscribe to the wrapper's
    // promise here so that we can re-render and read the real `siteLoaderData` once it
    // arrives.
    const pendingLoaderDataState = usePromise(pendingPromise);

    const siteLoaderData = useMemo(
        () =>
            pendingPromise !== null && !pendingLoaderDataState.isPending
                ? parseSiteLoaderDataIfPossible(pendingLoaderDataState.value)
                : // If there is no pending promise, or if there is a pending promise that hasn't
                  // settled yet, we use the immediately available `siteLoaderData`.
                  immediateSiteLoaderData,
        [pendingPromise, pendingLoaderDataState, immediateSiteLoaderData],
    );

    const activation = useStateWithDependenciesWithoutDispatch<
        SiteActivationState | null,
        [SiteLoaderData | null]
    >(
        ([siteLoaderData], previousActivation) =>
            computeNextActivation(siteLoaderData, previousActivation ?? null),
        [siteLoaderData],
    );

    const isFavoriteOnInitialLoad = useStateWithDependenciesWithoutDispatch<
        boolean,
        [SiteLoaderData | null]
    >(
        (isFavoriteOnInitialLoadFromProps, previousIsFavoriteOnInitialLoad) => {
            if (siteLoaderData === null) return false;

            // Set the initial value when we load the site for the first time.
            if (siteLoaderData.type === "UseNewSite") return siteLoaderData.isFavorite;

            // After the initial load, the value should never be undefined. Assert that is true
            // here.
            assert(previousIsFavoriteOnInitialLoad !== undefined);
            return previousIsFavoriteOnInitialLoad;
        },
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
                    // Force remount on site change to reset the realtime subscription.
                    key={activation.site.siteId}
                    siteId={activation.site.siteId}
                    initialQueryResult={activation.site.initialQueryResult}
                    activeEntityId={activation.activeEntityId}
                    isFavoriteOnInitialLoad={isFavoriteOnInitialLoad}
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
    isFavoriteOnInitialLoad,
    children,
}: {
    readonly siteId: SiteId;
    readonly initialQueryResult: RynamoQueryResult<SiteOrSiteEntryModel>;
    readonly activeEntityId: SiteItemSearchEntityId | null;
    readonly isFavoriteOnInitialLoad: boolean;
    readonly children: ReactNode;
}) {
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const siteRegistry = useSiteRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();

    const shouldConnectToRealtime = currentAccount !== null;

    const {isConnected, subscribeToEvents, subscribeToPongs} = useWebSocket(
        "SiteRealtimeService",
        SiteRealtimeProtocol,
        shouldConnectToRealtime ? `/api/durable-objects/sites/${siteId}` : null,
    );

    const favoriteSiteMenuAction = useSearchFavoriteEntityMenuAction(
        `Site:${siteId}`,
        isFavoriteOnInitialLoad,
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

    const sideBarState = useSideBarState({siteId, tree, activeEntityId});

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

    // Update `SearchEntityRegistry` with the latest data. Now as the name or first
    // entity change in realtime, any `SearchEntityModel`s rendered elsewhere in the
    // product will also update.
    useMemo(() => {
        return searchEntityRegistry.getEntityStore(
            new SearchEntityModel({
                type: "Site",
                site: {
                    id: site.id,
                    firstEntityId: site.firstEntityId,
                    version: site.version,
                },
                title: site.name,
            }),
        );
    }, [site.id, site.firstEntityId, site.version, site.name, searchEntityRegistry]);

    const contextValue = useMemo(
        (): SiteDataContextValue => ({
            siteId,
            tree,
            activeState,
            sideBarState,
            favoriteSiteMenuAction,
            updateTreeOptimistically,
            handleEventForSite,
            withPausedRealtimeEvents,
        }),
        [
            siteId,
            tree,
            activeState,
            sideBarState,
            favoriteSiteMenuAction,
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

export function useSite(): SitePreviewModelData {
    const {tree} = useSiteContext();

    // The tree always contains the site value from the store, so we can return it
    // directly here.
    return tree.site;
}

export function useSiteActiveState(): SiteActiveState {
    const {activeState} = useSiteContext();
    return activeState;
}

export function useSiteSideBarState(): SiteSideBarState {
    const {sideBarState} = useSiteContext();
    return sideBarState;
}

export function useFavoriteSiteMenuAction(): Memo<MenuAction> | null {
    const {favoriteSiteMenuAction} = useSiteContext();
    return favoriteSiteMenuAction;
}

export function useSiteTree(): SiteTreeForClient {
    const {tree} = useSiteContext();
    return tree;
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

/**
 * Initializes and exposes the sidebar UI state for the active site. Both pieces of
 * state — the collapsed-sections map and the one-shot scroll target — are keyed on
 * `siteId` via `useStateWithDependencies`, so navigating between sites resets back
 * to the "first paint" state (ancestors of the new active entity expanded, scroll
 * target armed). Within a single site the state survives cross-leaf navigation
 * because the surrounding `ActiveSiteDataProvider` doesn't re-mount.
 */
function useSideBarState({
    siteId,
    tree,
    activeEntityId,
}: {
    readonly siteId: SiteId;
    readonly tree: SiteTreeForClient;
    readonly activeEntityId: SiteItemSearchEntityId | null;
}): SiteSideBarState {
    const [collapsedSections, setCollapsedSections] = useStateWithDependencies<
        CollapsedSectionsState,
        readonly [SiteId]
    >(() => computeInitialCollapsedMap(tree, activeEntityId), [siteId]);

    const [scrollTargetState, setScrollTargetState] = useStateWithDependencies<
        {readonly entityId: SiteItemSearchEntityId | null},
        readonly [SiteId]
    >(() => ({entityId: activeEntityId}), [siteId]);

    const toggleSection = useCallback(
        (row: SectionRow) => {
            setCollapsedSections(current => {
                const next = new Map(current);
                next.set(row.entry.id, !isSectionCollapsed(current, row));
                return next;
            });
        },
        [setCollapsedSections],
    );

    const expandSection = useCallback(
        (row: SectionRow) => {
            setCollapsedSections(current => {
                if (!isSectionCollapsed(current, row)) return current;
                const next = new Map(current);
                next.set(row.entry.id, false);
                return next;
            });
        },
        [setCollapsedSections],
    );

    const clearInitialScrollTarget = useCallback(() => {
        setScrollTargetState(current => (current.entityId === null ? current : {entityId: null}));
    }, [setScrollTargetState]);

    return useMemo<SiteSideBarState>(
        () => ({
            collapsedSections,
            toggleSection,
            expandSection,
            initialScrollTargetEntityId: scrollTargetState.entityId,
            clearInitialScrollTarget,
        }),
        [
            collapsedSections,
            toggleSection,
            expandSection,
            scrollTargetState.entityId,
            clearInitialScrollTarget,
        ],
    );
}

/**
 * Builds the initial collapsed-sections map for a freshly-activated site. Every
 * section on the path from the sidebar root down to `activeEntityId` gets an
 * explicit `false` so the active row is visible without overriding the depth-based
 * defaults for other branches.
 */
function computeInitialCollapsedMap(
    tree: SiteTreeForClient,
    activeEntityId: SiteItemSearchEntityId | null,
): CollapsedSectionsState {
    if (activeEntityId === null) return emptyMap;

    const ancestorIds = getAncestorSectionIds(tree, activeEntityId);
    if (ancestorIds.length === 0) return emptyMap;

    const map = new Map<SiteSideBarSectionContainerId, true | false | undefined>();

    // We skip over the root section (depth 0) because it's always expanded by default.
    for (const id of ancestorIds.slice(1)) {
        map.set(id, false);
    }
    return map;
}

function getAncestorSectionIds(
    tree: SiteTreeForClient,
    entityId: SiteItemSearchEntityId,
): ReadonlyArray<SiteSideBarSectionContainerId> {
    const entry = tree.entryById.get(entityId);
    if (!entry) return [];

    const chain: Array<SiteSideBarSectionContainerId> = [];
    let currentParentId = entry.parentId;
    while (currentParentId !== null) {
        const parent = tree.getEntry(currentParentId);
        if (parent.type !== "SideBarSection") break;

        chain.push(parent.id);
        currentParentId = parent.parentId;
    }

    // We reverse the array here to communicate the depth of each parent in the chain.
    // Sections at depth 0 are collapsed by default, so we don't need to explicitly
    // expand them.
    return chain.toReversed();
}
