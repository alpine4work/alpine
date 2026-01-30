import {AppContext} from "~/client/web/context/app_context.js";
import {RpcCache} from "~/client/web/rpc/rpc_cache.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {RpcDefinitionOutputType} from "~/shared/rpc/rpc_definition.js";
import {searchByAffinity} from "~/shared/rpc/search_rpc_definitions.js";

/**
 * Force our `searchByAffinity()` RPC result to revalidate.
 *
 * Generally called after some mutation. Since `searchByAffinity()` uses
 * eventual consistency we retry a couple times until `condition` returns
 * true. `condition` should return true once update we made is reflected in
 * the `searchByAffinity()` output.
 *
 * Most of the time (especially in development) we should only need to call
 * `searchByAffinity()` once.
 */
export function forceRevalidateSearchByAffinity(
    context: AppContext,
    rpcCache: RpcCache,
    spaceId: SpaceId,
    afterName: string,
    condition: (output: RpcDefinitionOutputType<typeof searchByAffinity>) => boolean,
): SafeFloatingPromise<void> {
    const promise = context.tracer.withSpan(
        `Refetch search affinity list after ${afterName}`,
        async (context, span) => {
            let attemptCount = 0;
            let hasConditionPassed = false;

            try {
                // Refetch search affinity list up to 5 times until we see the expected
                // update. We refetch up to 5 times since `searchByAffinity()` uses eventual
                // consistency (and we can't easily give it a strong consistency mode). So if
                // we detect eventually consistent data, we retry!
                //
                // This is important when in `<SearchModal>` and "see all" is selected. We
                // want to see our update to the favorite shortcut count reflected in the
                // search list in realtime.
                while (attemptCount < 5) {
                    attemptCount++;

                    const output = await rpcCache.forceRevalidateEntry(context, searchByAffinity, {
                        spaceId,
                    });

                    // Stop trying to refetch once our condition is met.
                    if (condition(output)) {
                        hasConditionPassed = true;
                        break;
                    }
                }

                // Log a warning to the console in development if `condition` doesn't return
                // true. This should get a developer's attention so they can fix their
                // condition. `condition` should return true basically 100% of the time in
                // development since there's no eventual consistency lag in development.
                if (process.env.NODE_ENV !== "production" && !hasConditionPassed) {
                    // eslint-disable-next-line no-console
                    console.warn(
                        "`forceRevalidateSearchByAffinity()`\u2019s condition should eventually return true to avoid calling `searchByAffinity()` multiple times unnecessarily.",
                    );
                }
            } finally {
                span.addData({common: {count: attemptCount}});
            }
        },
    );

    return promise as SafeFloatingPromise<void>;
}
