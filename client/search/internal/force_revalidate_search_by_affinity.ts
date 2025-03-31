import {AppContext} from "~/client/context/app_context.js";
import {RpcCache} from "~/client/rpc/rpc_cache.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {RpcDefinitionOutputType} from "~/shared/rpc/rpc_definition.js";
import {searchByAffinity} from "~/shared/rpc/search_rpc_definitions.js";

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
                        break;
                    }
                }
            } finally {
                span.addData({common: {count: attemptCount}});
            }
        },
    );

    return promise as SafeFloatingPromise<void>;
}
