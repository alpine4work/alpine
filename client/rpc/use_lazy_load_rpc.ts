import {useMemo} from "react";
import useSwr, {preload} from "swr";
import {AppContext, useAppContext} from "~/client/context/app_context";
import {RpcDefinition} from "~/shared/rpc/rpc_definition";

function createFetcher<Input, Output>(context: AppContext, rpc: RpcDefinition<Input, Output>) {
    return (key: string): Promise<Output> => {
        const inputString = key.slice(rpc.name.length + 1);
        const input = rpc.inputSchema.deserialize(JSON.parse(inputString));
        return rpc(context, input);
    };
}

/**
 * Loads data from an RPC when the component mounts and calls the RPC again on
 * occasion to revalidate data and keep it up to date.
 *
 * Data requests with this hook are deduplicated and the responses are cached.
 * Two hooks fetching the same data will return the same result.
 *
 * Uses [SWR][1] under the hood.
 *
 * WARNING: Generally avoid using this hook since it leads to request
 * waterfalls! If your data is required to render a component, you should
 * render it in the route loader and pass it down. This is why we have "lazy
 * load" in the name, to force you to think about performance when using the
 * hook. Use this hook when you have a conditionally rendered component whose
 * data needs change with its state.
 *
 * We get the name from Relay's [`useLazyLoadQuery()`][2]. In the future we may
 * have a `usePreloadedRpc()` like Relay's `usePreloadedQuery()`. A
 * `usePreloadedRpc()` hook we could recommend as a good, performant solution
 * that doesn't cause request waterfalls!
 *
 * [1]: https://swr.vercel.app
 * [2]: https://relay.dev/docs/api-reference/use-lazy-load-query
 */
export function useLazyLoadLoadRpc<Input, Output>(
    rpc: RpcDefinition<Input, Output>,
    input: Input | null,
): {
    isLoading: boolean;
    isValidating: boolean;
    data: Output | undefined;
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

    const {isLoading, isValidating, data, error} = useSwr(
        inputString !== null ? `${rpc.name}:${inputString}` : null,
        fetcher,
        {
            // We should implement retry logic at the RPC function layer so any RPC caller
            // gets the benefit.
            shouldRetryOnError: false,
        },
    );

    // Handle errors at React error boundaries.
    if (error) throw error;

    return {isLoading, isValidating, data};
}

/**
 * Preload the result of an RPC and cache it. When `useLazyLoadLoadRpc()` is
 * called with the same arguments we will be able to use that cached or in
 * progress request.
 */
export function preloadRpc<Input, Output>(
    context: AppContext,
    rpc: RpcDefinition<Input, Output>,
    input: Input,
) {
    const inputString = JSON.stringify(rpc.inputSchema.serialize(input));
    const fetcher = createFetcher(context, rpc);
    preload(`${rpc.name}:${inputString}`, fetcher, {dedupe: true});
}
