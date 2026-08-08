import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.open_source.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.open_source.js";

let newSessionCache: Map<SessionId, Promise<AccountId | null>> | null = null;
let oldSessionCache: Map<SessionId, Promise<AccountId | null>> | null = null;

let sessionCacheInterval: Interval | null = null;

function ensureSessionCacheInterval() {
    if (sessionCacheInterval !== null) return;

    // Every 15 seconds demote `newSessionCache` to `oldSessionCache`. If nothing was
    // added to `newSessionCache` then we clear our interval. This means sessions live
    // in our cache for 30 seconds total. When sessions are in the `oldSessionCache` we
    // re-fetch them and add them to `newSessionCache`.
    sessionCacheInterval = createInterval(() => {
        oldSessionCache = newSessionCache;
        newSessionCache = null;

        if (oldSessionCache === null) {
            sessionCacheInterval!.clear();
            sessionCacheInterval = null;
        }
    }, 1000 * 15);

    // Allow the Node.js event loop to exit if this interval is the only remaining
    // active handle. This is important for Jest tests which don't terminate until all
    // active handles finish.
    sessionCacheInterval.unref?.();
}

// Minor optimization to avoid object allocations in hot code paths.
const wasCachedSpanData: TracerEventData = {common: {wasCached: true}} as const;
const wasNotCachedSpanData: TracerEventData = {common: {wasCached: false}} as const;

/**
 * Get the `AccountId` associated with a `SessionId`. If an `AccountId` is returned
 * then this session is valid! If `null` is returned then the session is revoked
 * and authentication fails.
 *
 * We cache session lookups in memory for up to 30 seconds. So we'll check whether
 * the session is revoked at least once every 30 seconds.
 *
 * It's very important that this function is fast! This blocks every request to our
 * backend. We should someday push for the p99.9 of this function to be <1ms.
 * Memcached is probably the answer here.
 */
export function getSessionIfExists(
    context: Context<DynamoContextModules & {process: ProcessContextModule}>,
    sessionId: SessionId,
): Promise<AccountId | null> {
    return context.tracer.withSpan("Get session", (context, span) => {
        // 1. Try to find the session in the new cache.
        {
            const newAccountIdPromise = newSessionCache?.get(sessionId);
            if (newAccountIdPromise !== undefined) {
                span.addData(wasCachedSpanData);
                return newAccountIdPromise;
            }
        }

        if (newSessionCache === null) {
            newSessionCache = new Map();
            ensureSessionCacheInterval();
        }

        // 2. Try to find the session in the old cache and re-fetch the session in the
        //    background when found.
        const oldAccountIdPromise = oldSessionCache?.get(sessionId);
        if (oldAccountIdPromise !== undefined) {
            const newAccountIdPromise = actuallyGetSessionIfExists(context, sessionId);
            context.process.waitUntil(newAccountIdPromise);

            newSessionCache.set(sessionId, newAccountIdPromise);

            // If the promise rejects, remove it from the cache so we don't poison the cache
            // with an error.
            newAccountIdPromise.catch(() => {
                if (newSessionCache?.get(sessionId) === newAccountIdPromise) {
                    newSessionCache.delete(sessionId);
                }
                if (oldSessionCache?.get(sessionId) === newAccountIdPromise) {
                    oldSessionCache.delete(sessionId);
                }
            });

            span.addData(wasCachedSpanData);
            return oldAccountIdPromise;
        }

        // 3. If the session isn't cached then fetch it from the database and put it in the
        //    cache.
        {
            const newAccountIdPromise = actuallyGetSessionIfExists(context, sessionId);

            newSessionCache.set(sessionId, newAccountIdPromise);

            // If the promise rejects, remove it from the cache so we don't poison the cache
            // with an error.
            newAccountIdPromise.catch(() => {
                if (newSessionCache?.get(sessionId) === newAccountIdPromise) {
                    newSessionCache.delete(sessionId);
                }
                if (oldSessionCache?.get(sessionId) === newAccountIdPromise) {
                    oldSessionCache.delete(sessionId);
                }
            });

            span.addData(wasNotCachedSpanData);
            return newAccountIdPromise;
        }
    });
}

async function actuallyGetSessionIfExists(
    context: DynamoContext,
    sessionId: SessionId,
): Promise<AccountId | null> {
    const sessionItem1 = await AccountsTable.getItemIfExists(context, {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId,
    });

    if (sessionItem1 !== null) return sessionItem1.accountId;

    // Try loading the session item again with strong consistency if we couldn't find
    // it the first time instead of throwing a "you don't have access to Alpine" error.
    const sessionItem2 = await AccountsTable.getItemIfExists(
        context,
        {
            partitionType: "Session",
            sortRangeType: "Attributes",
            sessionId,
        },
        {consistency: "Strong"},
    );

    if (sessionItem2 !== null) return sessionItem2.accountId;

    return null;
}
