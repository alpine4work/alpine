import {AgnosticDataRouteMatch} from "@remix-run/router";
import {ReactElement, useContext, useMemo} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {useSearchParams} from "react-router-dom";
import {Box} from "~/client/web/design/box.js";
import {useDevConsoleTool} from "~/client/web/helpers/dev_console.js";
import {usePromise} from "~/client/web/helpers/use_promise.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useInboxContext} from "~/client/web/inbox/inbox_context.js";
import {isLoadingIndicatorLoaderData} from "~/client/web/remix/loading_indicator_loader_data.js";
import {RouteShimmer} from "~/client/web/shimmer/route_shimmer.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {ValueStore} from "~/shared/store/value_store.js";

const shouldDebugRouteShimmer: CommitBlocker | null = null;

// Only allow `shouldDebugRouteShimmer` to be true in development.
if (process.env.NODE_ENV !== "development") {
    assert(!shouldDebugRouteShimmer);
}

let debugRouteShimmerStateStore: ValueStore<"Overlay" | "Full" | null> | undefined;

export function LoadingIndicatorSpaceOutletContainer({
    routeId,
    children,
}: {
    routeId: string;
    children: ReactElement | null;
}) {
    const [searchParams] = useSearchParams();
    const {matches, loaderData} = assertExists(useContext(DataRouterStateContext));
    const inboxContext = useInboxContext();

    const withInboxBanner = searchParams.get("inbox") === "show" || !!inboxContext?.entry;

    const promise = useMemo(() => {
        const index = matches.findIndex(match => match.route.id === routeId);
        assert(index !== -1);

        const promises: Array<PromiseImmediate<unknown>> = [];

        for (const match of matches.slice(index + 1)) {
            const data = loaderData[match.route.id];
            if (isLoadingIndicatorLoaderData(data)) {
                promises.push(data.promise);
            }
        }

        return PromiseImmediate.allSettled(promises);
    }, [loaderData, matches, routeId]);

    const promiseState = usePromise(promise);

    // Debug state is backed by a store shared globally across all
    // `<LoadingIndicatorSpaceOutletContainer>` on the page so if we call
    // `dev.shimmer.debugWithOverlay()` it shows the shimmer overlay both for non-peek
    // and peeks.
    const debugState = useStore(
        process.env.NODE_ENV !== "production" && typeof window !== "undefined"
            ? (debugRouteShimmerStateStore ??= new ValueStore<"Overlay" | "Full" | null>(null))
            : null,
    );

    useDevConsoleTool("shimmer", () => ({
        debugWithOverlay: () => {
            assert(process.env.NODE_ENV !== "production");
            assert(typeof window !== "undefined");

            debugRouteShimmerStateStore ??= new ValueStore<"Overlay" | "Full" | null>(null);

            debugRouteShimmerStateStore.set(previousDebugState => {
                if (previousDebugState !== null) return previousDebugState;
                return "Overlay";
            });
        },
        debug: () => {
            assert(process.env.NODE_ENV !== "production");
            assert(typeof window !== "undefined");

            debugRouteShimmerStateStore ??= new ValueStore<"Overlay" | "Full" | null>(null);

            // Once you transition to a full debugging state, we don't currently let you
            // transition back. Since once `loaderData` has been used it might not be able to
            // be used again (like for tasks which add data to a store on load and then release
            // the data on unmount).
            debugRouteShimmerStateStore.set(previousDebugState => {
                if (previousDebugState !== null && previousDebugState !== "Overlay")
                    return previousDebugState;
                return "Full";
            });
        },
    }));

    if (promiseState.isPending || debugState === "Full") {
        return (
            <Box flexGrow="1" overflow="hidden" position="relative" zIndex="0">
                <RouteShimmer
                    routeId={matches[matches.length - 1]?.route.id ?? null}
                    searchParams={searchParams}
                    withInboxBanner={withInboxBanner}
                />
            </Box>
        );
    }

    if (shouldDebugRouteShimmer || debugState === "Overlay") {
        return (
            <>
                <LoadingIndicatorDebugOverlay
                    matches={matches}
                    searchParams={searchParams}
                    withInboxBanner={withInboxBanner}
                />
                {children}
            </>
        );
    }

    return children;
}

function LoadingIndicatorDebugOverlay({
    matches,
    searchParams,
    withInboxBanner,
}: {
    matches: Array<AgnosticDataRouteMatch>;
    searchParams: URLSearchParams;
    withInboxBanner: boolean;
}) {
    return (
        <Box position="absolute" zIndex="90" inset="0" opacity="90" pointerEvents="none">
            <Box position="absolute" inset="0" zIndex="-10" backgroundColor="grey-0" opacity="60" />
            <RouteShimmer
                routeId={matches[matches.length - 1]?.route.id ?? null}
                searchParams={searchParams}
                withInboxBanner={withInboxBanner}
            />
        </Box>
    );
}
