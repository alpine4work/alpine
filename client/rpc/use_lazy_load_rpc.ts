import {useMemo, useRef} from "react";
import useSwr, {preload} from "swr";
import {AppContext, useAppContext} from "~/client/context/app_context.js";
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
 * Uses [SWR][1] under the hood. [This page][2] is helpful for understanding
 * the SWR lifecycle.
 *
 * WARNING: Generally avoid using this hook since it leads to request
 * waterfalls! If your data is required to render a component, you should
 * render it in the route loader and pass it down. This is why we have "lazy
 * load" in the name, to force you to think about performance when using the
 * hook. Use this hook when you have a conditionally rendered component whose
 * data needs change with its state.
 *
 * We get the name from Relay's [`useLazyLoadQuery()`][3]. In the future we may
 * have a `usePreloadedRpc()` like Relay's `usePreloadedQuery()`. A
 * `usePreloadedRpc()` hook we could recommend as a good, performant solution
 * that doesn't cause request waterfalls!
 *
 * [1]: https://swr.vercel.app
 * [2]: https://swr.vercel.app/docs/advanced/understanding
 * [3]: https://relay.dev/docs/api-reference/use-lazy-load-query
 */
export function useLazyLoadLoadRpc<Input, Output extends {}>(
    rpc: RpcDefinition<Input, Output>,
    input: Input | null,
    {
        keepPreviousData,
        initialOutput: _initialOutput,
    }: {
        /**
         * When the input changes, continue returning the previous data until we've
         * finished loading our new data. Helps you create better UXs around
         * loading data.
         *
         * We attach the input to the output so that when we return a stale output
         * you know what the input that created it is.
         *
         * [This diagram][1] is helpful for understanding the lifecycle.
         *
         * [1]: https://swr.vercel.app/docs/advanced/understanding#key-change--previous-data
         */
        keepPreviousData?: boolean;

        /**
         * The initial data returned by this RPC. Use when server-side rendering and
         * you want to load the data on the server.
         *
         * Different from SWC's `fallbackData` in that we will not fetch again on the
         * client. We will wait for key change or other invalidation to refetch.
         */
        initialOutput?: Replace<Output, {input: Input}>;
    } = {},
): {
    isLoading: boolean;
    isValidating: boolean;
    output: Replace<Output, {input: Input}> | undefined;
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

    const initialOutput = useMemo(() => {
        if (!_initialOutput) return null;

        const initialOutputInputString = JSON.stringify(
            rpc.inputSchema.serialize(_initialOutput.input),
        );

        return {inputString: initialOutputInputString, output: _initialOutput};
    }, [_initialOutput, rpc.inputSchema]);

    const hasInitiallyFetchedRef = useRef(false);

    const fetcher = useMemo(() => {
        const fetcher = createFetcher(context, rpc);

        if (!initialOutput) return fetcher;

        return (key: string) => {
            const isInitialFetch = !hasInitiallyFetchedRef.current;
            hasInitiallyFetchedRef.current = true;

            if (isInitialFetch && key === `${rpc.name}:${initialOutput.inputString}`) {
                return initialOutput.output;
            }

            return fetcher(key);
        };
    }, [context, initialOutput, rpc]);

    const {isLoading, isValidating, data, error} = useSwr(
        inputString !== null ? `${rpc.name}:${inputString}` : null,
        fetcher,
        {
            keepPreviousData: keepPreviousData && input !== null,
            fallbackData:
                initialOutput?.inputString === inputString ? initialOutput.output : undefined,
            // We should implement retry logic at the RPC function layer so any RPC caller
            // gets the benefit.
            shouldRetryOnError: false,
        },
    );

    // Handle errors at React error boundaries.
    if (error) throw error;

    return {
        isLoading,
        isValidating,
        output: data,
    };
}

/**
 * Preload the result of an RPC and cache it. When `useLazyLoadLoadRpc()` is
 * called with the same arguments we will be able to use that cached or in
 * progress request.
 */
export function preloadRpc<Input, Output extends {}>(
    context: AppContext,
    rpc: RpcDefinition<Input, Output>,
    input: Input,
) {
    const inputString = JSON.stringify(rpc.inputSchema.serialize(input));
    const fetcher = createFetcher(context, rpc);
    preload(`${rpc.name}:${inputString}`, fetcher, {dedupe: true});
}
