import {Iterator, RBTree} from "bintrees";
import {DurableObjectTransactionInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {InvalidArgumentError, UnimplementedError} from "~/shared/error/error.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";

/**
 * In-memory implementation of the Cloudflare Durable Object KV storage API.
 * Implements the full interface used by our code (`get()`, `put()`,
 * `delete()`, and `list()`). Backed by a binary search tree internally so we
 * can efficiently implement `list()`.
 */
export class TemporaryDurableObjectStorage implements DurableObjectTransactionInterface {
    private readonly _storage = new RBTree<{key: string; value: unknown}>((a, b) =>
        defaultCompareStrings(a.key, b.key),
    );

    public async get<T = unknown>(key: string): Promise<T | undefined> {
        const node = this._storage.find({key, value: undefined});
        return node?.value as T | undefined;
    }

    public async put<T>(key: string, value: T): Promise<void> {
        if (!this._storage.insert({key, value})) {
            this._storage.remove({key, value: undefined});
            this._storage.insert({key, value});
        }
    }

    public async delete(key: string): Promise<boolean> {
        return this._storage.remove({key, value: undefined});
    }

    public async list<T = unknown>({
        start,
        startAfter,
        end,
        prefix,
        reverse = false,
        limit,
    }: DurableObjectListOptions = {}): Promise<Map<string, T>> {
        if (start !== undefined && startAfter !== undefined) {
            throw new InvalidArgumentError("`start` and `startAfter` cannot be used together");
        }

        const result = new Map<string, any>();

        if (!reverse) {
            let iterator: Iterator<{key: string; value: unknown}> | null = null;

            const lowerBound = start ?? startAfter ?? prefix;
            if (lowerBound !== undefined) {
                iterator = this._storage.lowerBound({key: lowerBound, value: undefined});
            } else {
                iterator = this._storage.iterator();
                iterator.next();
            }

            if (
                startAfter !== undefined &&
                iterator !== null &&
                iterator.data()?.key === startAfter
            ) {
                iterator.next();
            }

            if (iterator === null) return result;

            let hasIterated = false;

            while (true) {
                const isFirstIteration = !hasIterated;
                hasIterated = true;

                const data = isFirstIteration ? iterator.data() : iterator.next();
                if (data === null) return result;

                if (prefix !== undefined && !data.key.startsWith(prefix)) return result;

                if (end !== undefined && data.key >= end) return result;

                result.set(data.key, data.value);

                if (limit !== undefined && result.size >= limit) return result;
            }
        } else {
            let iterator: Iterator<{key: string; value: unknown}> | null = null;

            let actualEnd = end;

            if (actualEnd === undefined && prefix !== undefined && prefix.length > 0) {
                const lastCharCode = prefix[prefix.length - 1]!.charCodeAt(0);
                actualEnd = prefix.slice(0, -1) + String.fromCharCode(lastCharCode + 1);
            }

            if (actualEnd !== undefined) {
                const max = this._storage.max();
                if (max !== null && max.key < actualEnd) {
                    iterator = this._storage.iterator();
                    iterator.prev();
                } else {
                    iterator = this._storage.lowerBound({key: actualEnd, value: undefined});
                    if (iterator === null) return result;

                    if (iterator.data() !== null) iterator.prev();
                }
            } else {
                iterator = this._storage.iterator();
                iterator.prev();
            }

            if (iterator === null) return result;

            let hasIterated = false;

            while (true) {
                const isFirstIteration = !hasIterated;
                hasIterated = true;

                const data = isFirstIteration ? iterator.data() : iterator.prev();
                if (data === null) return result;

                if (prefix !== undefined && !data.key.startsWith(prefix)) return result;

                if (start !== undefined && data.key < start) return result;
                if (startAfter !== undefined && data.key <= startAfter) return result;

                result.set(data.key, data.value);

                if (limit !== undefined && result.size >= limit) return result;
            }
        }
    }

    public rollback() {
        throw new UnimplementedError("Rollback not implemented for temporary storage");
    }
}
