import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {OrderKey, isOrderKey} from "~/shared/helpers/sort/order_key.js";
import {quote} from "~/shared/helpers/string/quote.js";

const durableObjectStorageCollectionPrefixes = new Set<OrderKey>();

type DurableObjectStorageInterfaceBase = {
    get<T = unknown>(key: string, options?: DurableObjectGetOptions): Promise<T | undefined>;
    list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>>;
    put<T>(key: string, value: T, options?: DurableObjectPutOptions): Promise<void>;
    delete(key: string, options?: DurableObjectPutOptions): Promise<boolean>;
};

assertAssignableTypes<DurableObjectStorage, DurableObjectStorageInterfaceBase>();

/**
 * An interface that's compatible with `DurableObjectStorage`,
 * `DurableObjectTransaction`, and `DurableObjectStorage` from
 * `@miniflare/durable-objects` (which is missing some of the latest Cloudflare
 * features).
 */
export type DurableObjectStorageInterface =
    | (DurableObjectStorageInterfaceBase & {
          transaction<Value>(
              action: (transaction: DurableObjectTransactionInterface) => Promise<Value>,
          ): Promise<Value>;
      })
    | DurableObjectTransactionInterface;

export type DurableObjectTransactionInterface = DurableObjectStorageInterfaceBase & {
    rollback(): void;
};

/**
 * Small helper for interacting with `DurableObjectStorage` that provides better
 * type safety.
 *
 * This helper also always enables `allowConcurrency: true`. We think very
 * carefully across concurrency throughout our distributed system so we trust
 * ourselves to write concurrent safe code in Cloudflare Durable Objects too.
 */
export class DurableObjectStorageCollection<Key extends string, Value> {
    public readonly prefix: string;

    constructor(prefix: string) {
        assert(isOrderKey(prefix), quote`Collection prefix ${prefix} must be an order key`);

        assert(
            !durableObjectStorageCollectionPrefixes.has(prefix),
            quote`Collection prefix ${prefix} must be unique`,
        );
        durableObjectStorageCollectionPrefixes.add(prefix);

        this.prefix = prefix;
    }

    public async get(storage: DurableObjectStorageInterface, key: Key): Promise<Value | undefined> {
        const value = await storage.get<Value>(`${this.prefix}_${key}`, {allowConcurrency: true});
        return value;
    }

    public put(storage: DurableObjectStorageInterface, key: Key, value: Value): Promise<void> {
        return storage.put(`${this.prefix}_${key}`, value, {allowConcurrency: true});
    }

    public getOrPutDefault(
        storage: DurableObjectStorageInterface,
        key: Key,
        getDefault: () => Promise<Value>,
    ): Promise<Value> {
        const action = async (transaction: DurableObjectTransactionInterface) => {
            let value = await transaction.get<Value>(`${this.prefix}_${key}`, {
                allowConcurrency: true,
            });

            if (value === undefined) {
                value = await getDefault();
                await transaction.put(`${this.prefix}_${key}`, value, {allowConcurrency: true});
            }

            return value;
        };

        if ("rollback" in storage) {
            return action(storage);
        } else {
            return storage.transaction(action);
        }
    }

    public delete(storage: DurableObjectStorageInterface, key: Key): Promise<boolean> {
        return storage.delete(`${this.prefix}_${key}`, {allowConcurrency: true});
    }

    public async list(
        storage: DurableObjectStorageInterface,
        options: Omit<DurableObjectListOptions, "prefix" | "allowConcurrency"> = {},
    ): Promise<Map<Key, Value>> {
        const actualMap = await storage.list<Value>({
            ...options,
            prefix: `${this.prefix}_`,
            allowConcurrency: true,
        });

        const map = new Map<Key, Value>();

        actualMap.forEach((value, actualKey) => {
            const key = actualKey.slice(this.prefix.length + 1) as Key;
            map.set(key, value);
        });

        return map;
    }
}
