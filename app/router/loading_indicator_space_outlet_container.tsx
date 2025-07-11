import {AgnosticDataRouteMatch} from "@remix-run/router";
import {ReactElement, useContext, useMemo} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {useSearchParams} from "react-router-dom";
import {Box} from "~/client/design/box.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {useInboxContext} from "~/client/inbox/inbox_context.js";
import {isLoadingIndicatorLoaderData} from "~/client/remix/loading_indicator_loader_data.js";
import {RouteShimmer} from "~/client/shimmer/route_shimmer.js";
import {useSpaceSideBarSpacing} from "~/client/spaces/route_metadata.js";
import {spaceLayoutStyles} from "~/client/styles/styles.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";

const shouldDebugRouteShimmer: CommitBlocker | null = null;

// Only allow `shouldDebugRouteShimmer` to be true in development.
if (process.env.NODE_ENV !== "development") {
    assert(!shouldDebugRouteShimmer);
}

export function LoadingIndicatorSpaceOutletContainer({
    routeId,
    hasSpaceLayoutSidebar = false,
    children,
}: {
    routeId: string;
    hasSpaceLayoutSidebar?: boolean;
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

    // TODO(calebmer): Instead of showing a fullscreen loading spinner, I'd prefer
    // rendering a shimmer for each route. That's a much better user experience.
    if (promiseState.isPending) {
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

    if (shouldDebugRouteShimmer) {
        return (
            <>
                <LoadingIndicatorDebugOverlay
                    matches={matches}
                    searchParams={searchParams}
                    withInboxBanner={withInboxBanner}
                    hasSpaceLayoutSidebar={hasSpaceLayoutSidebar}
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
    hasSpaceLayoutSidebar,
}: {
    matches: Array<AgnosticDataRouteMatch>;
    searchParams: URLSearchParams;
    withInboxBanner: boolean;
    hasSpaceLayoutSidebar: boolean;
}) {
    const spaceSideBarSpacing = useSpaceSideBarSpacing();

    return (
        <Box
            position="absolute"
            zIndex="90"
            inset="0"
            opacity="90"
            pointerEvents="none"
            style={{
                paddingLeft: hasSpaceLayoutSidebar
                    ? {
                          Always: spaceLayoutStyles.sideBarWidth,
                          Never: 0,
                          Sometimes: spaceLayoutStyles.sideBarSpace,
                      }[spaceSideBarSpacing]
                    : undefined,
            }}
        >
            <Box position="absolute" inset="0" zIndex="-10" backgroundColor="grey-0" opacity="60" />
            <RouteShimmer
                routeId={matches[matches.length - 1]?.route.id ?? null}
                searchParams={searchParams}
                withInboxBanner={withInboxBanner}
            />
        </Box>
    );
}
