import {useMemo} from "react";
import {AppContext, useAppContext} from "~/client/context/app_context.js";
import {useIdlyPreloadSwr, useSwr} from "~/client/rpc/use_swr.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";

function createFetcher<Input, Output extends {}>(
    context: AppContext,
    rpc: RpcDefinition<Input, Output>,
) {
    return async (key: string): Promise<Replace<Output, {readonly input: Input}>> => {
        const inputString = key.slice(rpc.name.length + 1);
        const input = rpc.inputSchema.deserialize(JSON.parse(inputString));
        const output = await rpc(context, input);
        return Object.assign(output, {input});
    };
}

/**
 * Loads data from an RPC when the component mounts and calls the RPC again on
 * occasion to revalidate data and keep it up to date.
 *
 * Data requests with this hook are deduplicated and the responses are cached.
 * Two hooks fetching the same data will return the same result.
 *
 * Uses a re-implementation of [SWR][1] under the hood. [This page][2] is
 * helpful for understanding the SWR lifecycle.
 *
 * WARNING: Generally avoid using this hook since it leads to request
 * waterfalls! If some data is required to render a component, you should
 * fetch it in the route loader and pass it down. This is why we have "lazy
 * load" in the name, to force you to think about performance when using the
 * hook. Use this hook when you have a conditionally rendered component where
 * the data it needs changes with its state.
 *
 * We get the name from Relay's [`useLazyLoadQuery()`][3]. In the future we may
 * have a `usePreloadedRpc()` like Relay's `usePreloadedQuery()`. A
 * `usePreloadedRpc()` hook that can load data on the server we could recommend
 * as a good, performant solution that doesn't cause request waterfalls!
 *
 * [1]: https://swr.vercel.app
 * [2]: https://swr.vercel.app/docs/advanced/understanding
 * [3]: https://relay.dev/docs/api-reference/use-lazy-load-query
 */
export function useLazyLoadRpc<Input, Output extends {}>(
    rpc: RpcDefinition<Input, Output>,
    input: Input | null,
    {
        keepPreviousData,
        initialOutput,
    }: {
        /**
         * When the input changes, continue returning the previous data until we've
         * finished loading our new data. Helps you create better UXs around
         * loading data.
         *
         * We attach the input to the output so that when we return a stale output
         * you know what the input that created it is.
         *
         * [This diagram][1] is helpful for understanding the hook's lifecycle.
         *
         * [1]: https://swr.vercel.app/docs/advanced/understanding#key-change--previous-data
         */
        keepPreviousData?: boolean;

        /**
         * Initial data to return from this hook. If provided then on initial mount we
         * won't call `fetcher` and will instead use the data from this object. The
         * data from this object will be placed in the cache so may be seen by other
         * `useSwr()` hooks observing the same key.
         */
        initialOutput?: Output | null;
    } = {},
): {
    isLoading: boolean;
    isValidating: boolean;
    output: Replace<Output, {input: Input}> | null;
} {
    const context = useAppContext();

    // NOTE(calebmer): `JSON.stringify()` preserves the order of keys. So if object
    // key order changes then we re-create the value. However if we checked
    // `isDeepEqual()` on two objects with different key orders then the key order
    // wouldn't matter. Given the browser heavily optimizes `JSON.stringify()` this
    // is an acceptable tradeoff. If we determine key order does matter we can use
    // a package like `json-stable-stringify`.
    const inputString = useMemo(
        () => (input !== null ? JSON.stringify(rpc.inputSchema.serialize(input)) : null),
        [input, rpc.inputSchema],
    );

    const fetcher = useMemo(() => createFetcher(context, rpc), [context, rpc]);

    const {isLoading, isValidating, data} = useSwr(
        inputString !== null ? `${rpc.name}:${inputString}` : null,
        fetcher,
        {
            keepPreviousData: keepPreviousData && input !== null,
            initialData: useMemo(
                () => (initialOutput ? {...initialOutput, input} : null),
                [initialOutput, input],
            ),
        },
    );

    return {
        isLoading,
        isValidating,
        output: data as Replace<Output, {input: Input}>,
    };
}

/**
 * Preload the result of an RPC and cache it. When `useLazyLoadRpc()` is
 * called with the same arguments we will be able to use that cached or in
 * progress request.
 */
export function useIdlyPreloadRpc<Input, Output extends {}>(
    rpc: RpcDefinition<Input, Output>,
    input: Input,
) {
    const context = useAppContext();
    const fetcher = useMemo(() => createFetcher(context, rpc), [context, rpc]);

    const inputString = useMemo(
        () => JSON.stringify(rpc.inputSchema.serialize(input)),
        [input, rpc.inputSchema],
    );

    useIdlyPreloadSwr(`${rpc.name}:${inputString}`, fetcher);
}
