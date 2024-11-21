import {AppContext} from "~/client/context/app_context.js";
import {createGlobalContext} from "~/client/helpers/global_context.js";
import {SwrCache, SwrCacheContext} from "~/client/rpc/swr_cache.js";
import {swrDefaultDedupingIntervalMs} from "~/client/rpc/use_swr.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";

export function getRpcCacheKey<Input, Output extends {}>(
    rpc: RpcDefinition<Input, Output>,
    input: Input,
) {
    // NOTE(calebmer): `JSON.stringify()` preserves the order of keys. So if object
    // key order changes then we re-create the value. However if we checked
    // `isDeepEqual()` on two objects with different key orders then the key order
    // wouldn't matter. Given the browser heavily optimizes `JSON.stringify()` this
    // is an acceptable tradeoff. If we determine key order does matter we can use
    // a package like `json-stable-stringify`.
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

/**
 * Wrapper around `SwrCache` that adheres to our access patterns for RPCs.
 */
export class RpcCache {
    private readonly _cache: SwrCache;

    constructor(cache: SwrCache) {
        this._cache = cache;
    }

    /**
     * Retain an entry in our cache so data in the cache isn't evicted.
     */
    public retain<Input, Output extends {}>(rpc: RpcDefinition<Input, Output>, input: Input) {
        const key = getRpcCacheKey(rpc, input);
        this._cache.retainEntry(key);
    }

    /**
     * Release an entry in our cache. Once the entry has a reference count of 0 it
     * will be evicted from the cache after a short window of time.
     */
    public release<Input, Output extends {}>(rpc: RpcDefinition<Input, Output>, input: Input) {
        const key = getRpcCacheKey(rpc, input);
        this._cache.releaseEntry(key);
    }

    /**
     * Force revalidation of the cache entry. This will always call the RPC even if
     * the RPC was called recently. Throws an error if the entry isn't retained.
     */
    public forceRevalidate<Input, Output extends {}>(
        context: AppContext,
        rpc: RpcDefinition<Input, Output>,
        input: Input,
    ): Promise<Replace<Output, {readonly input: Input}>> {
        const fetcher = createRpcCacheFetcher(context, rpc);
        const key = getRpcCacheKey(rpc, input);

        return this._cache.forceRevalidateEntry(key, fetcher, {
            dedupingInterval: swrDefaultDedupingIntervalMs,
        }) as Promise<Replace<Output, {readonly input: Input}>>;
    }
}

export const RpcCacheContext = createGlobalContext(get => new RpcCache(get(SwrCacheContext)));
