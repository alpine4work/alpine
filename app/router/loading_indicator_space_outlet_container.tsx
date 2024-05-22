import {SpinnerGap} from "phosphor-react";
import {ReactElement, useContext, useMemo} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {Box} from "~/client/design/box.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {isLoadingIndicatorLoaderData} from "~/client/remix/loading_indicator_loader_data.js";
import {spacing} from "~/shared/design/spacing.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {colorSchemeVars, spinAnimationClassName} from "~/shared/styles/styles.js";

export function LoadingIndicatorSpaceOutletContainer({
    routeId,
    withMobileLayout,
    children,
}: {
    routeId: string;
    withMobileLayout: boolean;
    children: ReactElement | null;
}) {
    const dataRouterStateContext = assertExists(useContext(DataRouterStateContext));

    const promise = useMemo(() => {
        const index = dataRouterStateContext.matches.findIndex(match => {
            return match.route.id === routeId;
        });
        assert(index !== -1);

        const promises: Array<PromiseImmediate<unknown>> = [];

        for (const match of dataRouterStateContext.matches.slice(index + 1)) {
            const loaderData = dataRouterStateContext.loaderData[match.route.id];
            if (isLoadingIndicatorLoaderData(loaderData)) {
                promises.push(loaderData.promise);
            }
        }

        return PromiseImmediate.allSettled(promises);
    }, [dataRouterStateContext.loaderData, dataRouterStateContext.matches, routeId]);

    const promiseState = usePromise(promise);

    // TODO(calebmer): Instead of showing a fullscreen loading spinner, I'd prefer
    // rendering a shimmer for each route. That's a much better user experience.
    if (promiseState.isPending) {
        return (
            <Box flexGrow="1" display="flex" justifyContent="center" alignItems="center">
                <SpinnerGap
                    className={spinAnimationClassName}
                    color={colorSchemeVars["grey-70"]}
                    size={spacing[withMobileLayout ? "6" : "8"]}
                />
            </Box>
        );
    }

    return children;
}
