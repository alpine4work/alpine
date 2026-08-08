import {AppContext} from "~/client/web/context/app_context.js";
import {createGlobalContext} from "~/client/web/helpers/global_context.js";
import {SwrCache, SwrCacheContext} from "~/client/web/rpc/internal/swr_cache.js";
import {Replace} from "~/shared/helpers/types/replace.open_source.js";
import {SafeFloatingPromiseLike} from "~/shared/helpers/types/safe_floating_promise.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";

export function getRpcCacheKey<Input, Output extends {}>(
    rpc: RpcDefinition<Input, Output>,
    input: Input,
) {
    // NOTE(calebmer): `JSON.stringify()` preserves the order of keys. So if object key
    // order changes then we re-create the value. However if we checked `isDeepEqual()`
    // on two objects with different key orders then the key order wouldn't matter.
    // Given the browser heavily optimizes `JSON.stringify()` this is an acceptable
    // tradeoff. If we determine key order does matter we can use a package like
    // `json-stable-stringify`.
    const inputString = JSON.stringify(rpc.inputSchema.serialize(input));

    return `${rpc.name}:${inputString}`;
}

export function createRpcCacheFetcher<Input, Output extends {}>(
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

export class RpcCache {
    private readonly _cache: SwrCache;

    constructor(cache: SwrCache) {
        this._cache = cache;
    }

    public revalidateEntry<Input, Output extends {}>(
        context: AppContext,
        rpc: RpcDefinition<Input, Output>,
        input: Input,
        options?: {dedupingInterval: number},
    ): void {
        const fetcher = createRpcCacheFetcher(context, rpc);
        const key = getRpcCacheKey(rpc, input);

        return this._cache.revalidateEntry(key, fetcher, options);
    }

    public revalidateEntryIfNotAvailable<Input, Output extends {}>(
        context: AppContext,
        rpc: RpcDefinition<Input, Output>,
        input: Input,
        options?: {dedupingInterval: number},
    ): void {
        const fetcher = createRpcCacheFetcher(context, rpc);
        const key = getRpcCacheKey(rpc, input);

        return this._cache.revalidateEntryIfNotAvailable(key, fetcher, options);
    }

    public forceRevalidateEntry<Input, Output extends {}>(
        context: AppContext,
        rpc: RpcDefinition<Input, Output>,
        input: Input,
        options?: {dedupingInterval: number},
    ): SafeFloatingPromiseLike<Replace<Output, {readonly input: Input}>> {
        const fetcher = createRpcCacheFetcher(context, rpc);
        const key = getRpcCacheKey(rpc, input);

        return this._cache.forceRevalidateEntry(key, fetcher, options) as SafeFloatingPromiseLike<
            Replace<Output, {readonly input: Input}>
        >;
    }

    public addOptimisticUpdate<Input, Output extends {}>(
        rpc: RpcDefinition<Input, Output>,
        input: Input,
        promise: Promise<unknown>,
        update: (output: Output) => Output,
    ): void {
        const key = getRpcCacheKey(rpc, input);

        return this._cache.addOptimisticUpdate(key, promise, (output: any) =>
            Object.assign(update(output), {input: output.input}),
        );
    }
}

export const RpcCacheContext = createGlobalContext(get => new RpcCache(get(SwrCacheContext)));
