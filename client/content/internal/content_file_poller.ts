import {AppContext} from "~/client/context/app_context.js";
import {createGlobalContext} from "~/client/helpers/global_context.js";
import {RpcCache, RpcCacheContext} from "~/client/rpc/rpc_cache.js";
import {
    FileAttachmentTarget,
    serializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {getFileFromAttachment} from "~/shared/rpc/files_rpc_definitions.js";

/**
 * Get how much time to wait in seconds before polling the content file again
 * for attempt number `x`.
 */
const getPollWaitSeconds = (() => {
    // Poll wait time is based on an `arctan()` function. The poll time starts
    // at 0.2 seconds (`b`) and grows slowly then starts to grow more rapidly and
    // eventually slows down never exceeding 5 seconds (`a`).
    //
    // This has the effect of polling very quickly at the start and eventually
    // slowing down if we're not receiving data back from the server.
    //
    // - `a` is the maximum wait time in seconds. It's the limit of the function,
    //   taken to infinity the function will reach this value.
    //
    // - `b` is the starting wait time in seconds.
    //
    // - `c` is the attempt number where the wait time will be `a / 2`. It's the
    //   inflection point of the function.
    //
    // The worksheet where I came up with this math:
    // https://www.desmos.com/calculator/4txalg6zjc
    const a = 5;
    const b = 0.2;
    const c = 14;

    const pi = Math.PI;
    const arctan = Math.atan;
    const cot = (x: number) => 1 / Math.tan(x);

    const n1 = cot((pi * b) / a);
    const n2 = 2 * pi;

    return (x: number) => (a * (pi - 2 * arctan(((c - x) * n1) / c))) / n2;
})();

type ContentFilePollerReference = {
    getContext: () => AppContext;
    onPoll: ((output: {signedUrlSearch: string; file: FileModel}) => void) | undefined;
};

/**
 * Manages file polling state. We only want to have one poll loop per file
 * across our entire app. This class maintains that state. The file poller
 * makes requests through `SwrCache`. Which is useful specifically for
 * `<ContentFileViewerModal>` which reads its file data from `SwrCache`.
 */
class ContentFilePoller {
    private readonly _cache: RpcCache;

    public readonly _stateByKey = new Map<
        string,
        {references: Array<ContentFilePollerReference>}
    >();

    constructor(cache: RpcCache) {
        this._cache = cache;
    }

    /**
     * Start polling for a file. We'll call the `getFileFromAttachment()` RPC every
     * so often (every 200ms at first) until the file has loaded. Call the cleanup
     * function when you want to finish polling. When you call this function we'll
     * always call the `getFileFromAttachment()` RPC at least once. So don't call
     * this function if you already have a loaded `FileModel`.
     *
     * If you call the cleanup function, we won't stop the poll timeout loop until
     * the next time the timeout loop fires. That way if you call the cleanup
     * function then immediately call `poll()` again we won't restart the poll
     * loop. Useful if you're calling `poll()` in a `useEffect()` which re-runs
     * whenever some state changes.
     */
    public startPolling(
        getContext: () => AppContext,
        {
            spaceId,
            fileId,
            target,
            onPoll,
        }: {
            spaceId: SpaceId;
            fileId: FileId;
            target: FileAttachmentTarget;
            onPoll?: (output: {signedUrlSearch: string; file: FileModel}) => void;
        },
    ): () => void {
        const key = `${spaceId}:${fileId}:${serializeFileAttachmentTargetString(target)}`;

        const state = getOrSetDefaultMapValue(this._stateByKey, key, () => {
            const references: Array<ContentFilePollerReference> = [];

            this._startPolling({
                references,
                spaceId,
                fileId,
                target,
                cleanup: () => this._stateByKey.delete(key),
            });

            return {references};
        });

        let hasCleanedUp = false;

        const reference: ContentFilePollerReference = {getContext, onPoll};
        state.references.push(reference);

        return () => {
            assert(!hasCleanedUp);
            hasCleanedUp = true;

            const index = state.references.indexOf(reference);
            assert(index !== -1);

            // If this leaves us with 0 references then `_startPolling()` will cleanup the
            // next time its timeout fires.
            state.references.splice(index, 1);
        };
    }

    private _startPolling({
        references,
        spaceId,
        fileId,
        target,
        cleanup,
    }: {
        references: Array<ContentFilePollerReference>;
        spaceId: SpaceId;
        fileId: FileId;
        target: FileAttachmentTarget;
        cleanup: () => void;
    }) {
        let pollCount = 0;
        let pollErrorCount = 0;
        let pollTimeout: Timeout | null = null;

        const input = {
            spaceId,
            fileId,
            target,
        };

        // While polling, retain the file in our RPC cache. This will prevent file data
        // from being evicted.
        this._cache.retain(getFileFromAttachment, input);

        const schedulePoll = () => {
            assert(pollTimeout === null);

            const waitMs = Math.round(getPollWaitSeconds(pollCount) * 1000);
            pollCount++;

            pollTimeout = createTimeout(() => {
                pollTimeout = null;
                poll();
            }, waitMs);
        };

        const poll = () => {
            // If there are no more references then cleanup our poll loop for this file.
            if (references.length === 0) {
                this._cache.release(getFileFromAttachment, input);
                cleanup();
                return;
            }

            // Use the `AppContext` of our first reference when making the RPC call.
            const context = references[0]!.getContext();

            this._cache.forceRevalidate(context, getFileFromAttachment, input).then(
                output => {
                    if (output.file.isLoading()) {
                        schedulePoll();
                    }

                    for (const reference of references) {
                        try {
                            reference.onPoll?.(output);
                        } catch (error) {
                            scheduleUncaughtError(error);
                        }
                    }
                },
                error => {
                    pollErrorCount++;

                    if (pollErrorCount < 3) {
                        schedulePoll();
                    } else {
                        context.tracer
                            .getRoot()
                            .logUncaughtException(
                                "Polling for file that hasn't finished loading failed",
                                error,
                            );
                    }
                },
            );
        };

        schedulePoll();
    }
}

export const ContentFilePollerContext = createGlobalContext(
    get => new ContentFilePoller(get(RpcCacheContext)),
);
