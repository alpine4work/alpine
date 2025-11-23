import {unstable_LowPriority, unstable_scheduleCallback} from "scheduler";
import {AppContext} from "~/client/web/context/app_context.js";
import {
    getContentReferencesFileSignedUrlSearchExpirationTime,
    mergeContentReferencesFileSignedUrlSearches,
} from "~/shared/content/content_references.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {
    FileModel,
    FileModelData,
    isFileModelDataLoading,
    minFileModelDataLoadingCount,
} from "~/shared/files/file_model.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {AdvancedWeakValuesMap} from "~/shared/helpers/map/advanced_weak_values_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    getFileSignedUrlAsUploader,
    getFileSignedUrlFromAttachment,
    getFileWithoutSignedUrlAsUploader,
    getFileWithoutSignedUrlFromAttachment,
} from "~/shared/rpc/files_rpc_definitions.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

let isStartMaintainingFileDisabledForTest = false;

export function disableStartMaintainingFileForTest() {
    assert(import.meta.jest);
    isStartMaintainingFileDisabledForTest = true;
}

const fileSignedUrlEagerExpirationDurationMs = 1000 * 20;
const fileSignedUrlRefreshDurationMs = fileSignedUrlEagerExpirationDurationMs + 1000 * 20;

/**
 * Get how much time to wait in seconds before polling the content file again
 * for attempt number `x`.
 */
const getFilePollWaitSeconds = (() => {
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

export type FileModelRegistryData = FileModelData & {
    readonly signedUrlSearch: string;
    readonly isSignedUrlExpired: boolean;
};

type FileRegistryState = {
    referenceCount: number;
    getContexts: Array<() => AppContext>;
    attachmentTargets: Array<FileAttachmentTarget | "Uploader">;
    unsubscribeFromStore: (() => void) | null;
    expirationTimeout: Timeout | null;
    refreshTimeout: Timeout | null;
    lastRefreshedSignedUrlSearch: string | null;
    poll: {
        attempt: number;
        time: number;
        hasStarted: boolean;
        timeout: Timeout | null;
    } | null;
    cleanupTimeout: Timeout | null;
};

/**
 * Normalized registry of file model data for the client. We may render the
 * same `FileModel` in multiple different places in the product at the same
 * time. For example in a post, in a channel files section, and in a file
 * viewer modal. We want files across all these surfaces to be consistent. And
 * to have the following behaviors:
 *
 * 1. The file should use the same signed URL in all the places its rendered to
 *    leverage browser caching.
 *
 * 2. If the file is processing we should have one polling loop across the
 *    entire app that'll tell us when the file is done processing.
 *
 * 3. If the file's signed URL is expired we should refresh it once for the
 *    app.
 *
 * Most of the time a file is only rendered in a single place at once. This
 * store is still useful for implementing the file stateful behaviors listed
 * above.
 *
 * Written so that stores are garbage collected when there are no more
 * references to the associated `FileModel`s in our realm.
 *
 * We should only have one `FileRegistry` per space. We assume all file
 * models in this store are in the same space.
 */
export class FileRegistry {
    private readonly _spaceId: SpaceId;

    private _scheduledFileUpdates: Array<FileModelRegistryData> | null = null;

    // NOTE(calebmer): We broadly discourage usage of `AdvancedWeakValuesMap` since
    // it leads to non-deterministic behavior. This class is fine since you call
    // `getFileStore()` which doesn't introduce non-deterministic behavior due to
    // JavaScript garbage collector timing.
    //
    // We could use a simple `Map` but that would lead to a memory leak since
    // file data would never be garbage collected. Account data is small so
    // arguably a memory leak is acceptable.
    private readonly _fileStoreById = new AdvancedWeakValuesMap<
        FileId,
        ValueStore<FileModelRegistryData>
    >();

    private readonly _fileStoreByModel = new WeakMap<
        FileModel,
        ValueStore<FileModelRegistryData>
    >();

    private readonly _fileStateById = new Map<FileId, FileRegistryState>();

    constructor(spaceId: SpaceId) {
        this._spaceId = spaceId;
    }

    private _getFileStoreWithoutUpdating(
        file: FileModel,
        fileData: FileModelRegistryData,
    ): ValueStore<FileModelRegistryData> {
        const fileStore = getOrSetDefaultMapValue(
            this._fileStoreById,
            file.id,
            () => new ValueStore(fileData),
        );

        // As long as the `FileModel` lives, hold a reference to
        // `ValueStore<FileModelRegistryData>`. This prevents a bug where we're in a
        // virtualized scroll view and a component rendering a `FileModel` is
        // scrolled offscreen so it no longer references the store so the store is
        // garbage collected. If the store held newer `FileModelRegistryData` then when
        // you scroll and `FileModel` is back onscreen it will appear like the file
        // reverted to its original state.
        //
        // `FileModel` will still be referenced by whatever data is backing the
        // virtualized scroll view. So keep a reference to the store alive while the
        // `FileModel` is alive.
        this._fileStoreByModel.set(file, fileStore);

        return fileStore;
    }

    private _getFileStore({
        signedUrlSearch,
        file,
    }: {
        signedUrlSearch: string;
        file: FileModel;
    }): ValueStore<FileModelRegistryData> {
        const expirationTime =
            getContentReferencesFileSignedUrlSearchExpirationTime(signedUrlSearch);

        const eagerExpirationTime = expirationTime - fileSignedUrlEagerExpirationDurationMs;

        const fileData = {
            ...file.initialData,
            signedUrlSearch,
            isSignedUrlExpired: Date.now() >= eagerExpirationTime,
        };

        const fileStore = this._getFileStoreWithoutUpdating(file, fileData);

        // Don't schedule file update on the server.
        if (typeof window !== "undefined") {
            const fileDataSnapshot = fileStore.getSnapshot();
            if (mergeFileModelRegistryData(fileDataSnapshot, fileData) !== fileDataSnapshot) {
                this._scheduleFileUpdate(fileData);
            }
        }

        return fileStore;
    }

    /**
     * Get the normalized file data store for our `FileModel`.
     *
     * If our store hasn't seen the file yet then we'll initialize a store with
     * the `FileModel`'s `initialData`.
     *
     * If our store has seen the file but our `FileModel`'s `initialData` is
     * newer than what's in the store, we will schedule a render with the file's
     * new data. Updating everywhere the file is visible in the product.
     */
    public getFileStore(fileReference: {
        signedUrlSearch: string;
        file: FileModel;
    }): Store<FileModelRegistryData> {
        // This function returns a `Store` which you can't call `set()` on. Whereas the
        // private `_getFileStore()` returns a `FileStore` which does have a setter.
        return this._getFileStore(fileReference);
    }

    private _scheduleFileUpdate(data: FileModelRegistryData) {
        assert(typeof window !== "undefined");

        if (this._scheduledFileUpdates !== null) {
            this._scheduledFileUpdates.push(data);
        } else {
            this._scheduledFileUpdates = [data];

            // Use the React scheduler to schedule a low priority update. If React is
            // processing user actions then we want that to finish before rendering
            // new accounts.
            unstable_scheduleCallback(unstable_LowPriority, () => {
                this._runScheduledFileUpdates();
            });
        }
    }

    private _runScheduledFileUpdates() {
        const scheduledFileUpdates = this._scheduledFileUpdates;
        this._scheduledFileUpdates = null;
        if (scheduledFileUpdates === null) return;

        batchStoreUpdates(() => {
            for (const newFileData of scheduledFileUpdates) {
                this._fileStoreById
                    .get(newFileData.id)
                    ?.set(oldFileData => mergeFileModelRegistryData(oldFileData, newFileData));
            }
        });
    }

    /**
     * Start maintaining a file's state. To stop maintaining a file's state call
     * the returned stop function. Maintaining a file's state means:
     *
     * 1. If the file is processing we poll the file for updates every few
     *    milliseconds
     *
     * 2. If the file is about to expire we refresh the signed URL so the user can
     *    keep viewing the file
     *
     * 3. If the file is expired then we update the file's state setting an
     *    `isSignedUrlExpired` flag to true
     *
     * If you call `startMaintainingFile()` multiple times for the same file then
     * we dedupe the calls. So there'll only ever be one polling loop for a file
     * and we'll only refresh a file once.
     */
    public startMaintainingFile(
        getContext: () => AppContext,
        initialFileDataOrReference:
            | FileModelRegistryData
            | {signedUrlSearch: string; file: FileModel},
        attachmentTarget: FileAttachmentTarget | "Uploader",
    ): () => void {
        if (import.meta.jest && isStartMaintainingFileDisabledForTest) return noop;

        const fileId =
            "file" in initialFileDataOrReference
                ? initialFileDataOrReference.file.id
                : initialFileDataOrReference.id;

        // Hold onto a file store reference for the duration of this function. The
        // `fileStore` won't be garbage collected until our cleanup function is called
        // and collected.
        const fileStore =
            "file" in initialFileDataOrReference
                ? this._getFileStore(initialFileDataOrReference)
                : getOrSetDefaultMapValue(
                      this._fileStoreById,
                      initialFileDataOrReference.id,
                      () => new ValueStore(initialFileDataOrReference),
                  );

        const fileState = getOrSetDefaultMapValue(this._fileStateById, fileId, () => ({
            referenceCount: 0,
            getContexts: [],
            attachmentTargets: [],
            unsubscribeFromStore: null,
            expirationTimeout: null,
            refreshTimeout: null,
            lastRefreshedSignedUrlSearch: null,
            poll: null,
            cleanupTimeout: null,
        }));

        fileState.referenceCount++;
        fileState.getContexts.push(getContext);
        fileState.attachmentTargets.push(attachmentTarget);
        fileState.cleanupTimeout?.clear();
        fileState.cleanupTimeout = null;

        // If we're the first reference then start running our timers for the file. We
        // may be reviving an old `fileState` object that has zero references but
        // hasn't been cleaned up yet.
        if (fileState.referenceCount === 1) {
            this._startMaintainingFile(fileId, fileStore, fileState);
        }

        let hasCleanedUp = false;

        return () => {
            assert(!hasCleanedUp);
            hasCleanedUp = true;

            fileState.referenceCount--;

            const getContextIndex = fileState.getContexts.indexOf(getContext);
            assert(getContextIndex !== -1);
            fileState.getContexts.splice(getContextIndex, 1);

            const attachmentTargetIndex = fileState.attachmentTargets.indexOf(
                attachmentTarget ?? "Uploader",
            );
            assert(attachmentTargetIndex !== -1);
            fileState.attachmentTargets.splice(attachmentTargetIndex, 1);

            // If our references go to 0 then wait a second before actually cleaning up the
            // file state. This allows file state to be revived if `maintainFileState()` is
            // immediately called again after the cleanup function. Which happens in React
            // effects.
            if (fileState.referenceCount === 0) {
                assert(fileState.unsubscribeFromStore !== null);
                fileState.unsubscribeFromStore();
                fileState.unsubscribeFromStore = null;

                fileState.expirationTimeout?.clear();
                fileState.expirationTimeout = null;

                fileState.refreshTimeout?.clear();
                fileState.refreshTimeout = null;

                if (fileState.poll) {
                    fileState.poll.timeout?.clear();
                    fileState.poll.timeout = null;
                }

                assert(fileState.cleanupTimeout === null);
                fileState.cleanupTimeout = createTimeout(() => {
                    this._fileStateById.delete(fileId);
                }, 1000);
            }

            // Do something with the `fileStore` to make sure it's not garbage
            // collected until the cleanup function is garbage collected.
            fileStore.getSnapshot();
        };
    }

    private _startMaintainingFile(
        fileId: FileId,
        fileStore: ValueStore<FileModelRegistryData>,
        fileState: FileRegistryState,
    ) {
        const update = () => {
            const file = fileStore.getSnapshot();

            const expirationTime = getContentReferencesFileSignedUrlSearchExpirationTime(
                file.signedUrlSearch,
            );

            const currentTime = Date.now();
            const eagerExpirationTime = expirationTime - fileSignedUrlEagerExpirationDurationMs;
            const refreshTime = expirationTime - fileSignedUrlRefreshDurationMs;

            // When the file expires, mark `isSignedUrlExpired` as `true`. We set
            // `isSignedUrlExpired` to `true` a bit before the file actually expires (the
            // eager expiration time) to avoid time skew issues.
            {
                fileState.expirationTimeout?.clear();
                if (currentTime > eagerExpirationTime) {
                    fileState.expirationTimeout = null;

                    if (!file.isSignedUrlExpired) {
                        fileStore.set({...file, isSignedUrlExpired: true});
                    }
                } else {
                    if (file.isSignedUrlExpired) {
                        fileState.expirationTimeout = null;
                    } else {
                        fileState.expirationTimeout = createTimeout(() => {
                            fileStore.set({...file, isSignedUrlExpired: true});
                        }, eagerExpirationTime - currentTime);
                    }
                }
            }

            // Before the file expires, refresh the signed URL. So ideally we always have a
            // valid URL for the file.
            {
                const maybeRefreshSignedUrl = () => {
                    // If we've already sent a refresh request for this signed URL then don't send
                    // another refresh request.
                    if (fileState.lastRefreshedSignedUrlSearch === file.signedUrlSearch) return;
                    fileState.lastRefreshedSignedUrlSearch = file.signedUrlSearch;

                    const getContext = assertExists(fileState.getContexts[0]);
                    const attachmentTarget = assertExists(fileState.attachmentTargets[0]);

                    (attachmentTarget === "Uploader"
                        ? getFileSignedUrlAsUploader(getContext(), {
                              spaceId: this._spaceId,
                              fileId,
                          })
                        : getFileSignedUrlFromAttachment(getContext(), {
                              spaceId: this._spaceId,
                              fileId,
                              target: attachmentTarget,
                          })
                    ).then(
                        output => {
                            fileStore.set(file => {
                                const expirationTime =
                                    getContentReferencesFileSignedUrlSearchExpirationTime(
                                        file.signedUrlSearch,
                                    );

                                const refreshTime = expirationTime - fileSignedUrlRefreshDurationMs;

                                // If the file has updated such that `refreshTime` is now in the future, don't
                                // update the signed URL since the `signedUrlSearch` must have already been
                                // updated.
                                if (Date.now() <= refreshTime) return file;

                                return {
                                    ...file,
                                    signedUrlSearch: output.signedUrlSearch,
                                    isSignedUrlExpired: false,
                                };
                            });
                        },
                        error => {
                            // TODO: We should retry this RPC if there's an error. Ideally retries are done
                            // at the RPC client layer. We should have an `isIdempotent` flag for RPCs and
                            // retry any idempotent RPCs until they succeed.
                            getContext()
                                .tracer.getRoot()
                                .logException(
                                    "Couldn’t refresh expired file preview URL signature",
                                    error,
                                );
                        },
                    );
                };

                fileState.refreshTimeout?.clear();
                if (currentTime > refreshTime) {
                    fileState.refreshTimeout = null;
                    maybeRefreshSignedUrl();
                } else {
                    fileState.refreshTimeout = createTimeout(
                        maybeRefreshSignedUrl,
                        refreshTime - currentTime,
                    );
                }
            }

            // While the file is loading, poll the server for updates. We don't have a
            // realtime connection for files since they're immutable after they've finished
            // processing so instead if we have a file that's currently processing we poll.
            if (!isFileModelDataLoading(file)) {
                fileState.poll?.timeout?.clear();
                fileState.poll = null;
            } else {
                if (fileState.poll === null) {
                    const attempt = 0;

                    fileState.poll = {
                        attempt,
                        time: currentTime + getFilePollWaitSeconds(attempt) * 1000,
                        hasStarted: false,
                        timeout: null,
                    };
                }

                const maybePoll = () => {
                    // If we've already sent a poll request for this file then don't send another
                    // refresh request.
                    if (!fileState.poll || fileState.poll.hasStarted) return;
                    fileState.poll.hasStarted = true;

                    const pollState = fileState.poll;

                    const getContext = assertExists(fileState.getContexts[0]);
                    const attachmentTarget = assertExists(fileState.attachmentTargets[0]);

                    (attachmentTarget === "Uploader"
                        ? getFileWithoutSignedUrlAsUploader(getContext(), {
                              spaceId: this._spaceId,
                              fileId,
                          })
                        : getFileWithoutSignedUrlFromAttachment(getContext(), {
                              spaceId: this._spaceId,
                              fileId,
                              target: attachmentTarget,
                          })
                    ).then(
                        output => {
                            fileStore.set(file =>
                                mergeFileModelRegistryData(file, {
                                    ...output.file.initialData,
                                    signedUrlSearch: file.signedUrlSearch,
                                    isSignedUrlExpired: file.isSignedUrlExpired,
                                }),
                            );

                            if (!isFileModelDataLoading(fileStore.getSnapshot())) {
                                fileState.poll = null;
                            } else {
                                const currentTime = Date.now();
                                const attempt = pollState.attempt + 1;
                                const time = currentTime + getFilePollWaitSeconds(attempt) * 1000;

                                fileState.poll = {
                                    attempt,
                                    time,
                                    hasStarted: false,
                                    timeout: createTimeout(maybePoll, time - currentTime),
                                };
                            }
                        },
                        error => {
                            // TODO: We should retry this RPC if there's an error. Ideally retries are done
                            // at the RPC client layer. We should have an `isIdempotent` flag for RPCs and
                            // retry any idempotent RPCs until they succeed.
                            getContext()
                                .tracer.getRoot()
                                .logException(
                                    "Polling for file that hasn’t finished loading failed",
                                    error,
                                );
                        },
                    );
                };

                fileState.poll.timeout?.clear();
                if (currentTime > fileState.poll.time) {
                    fileState.poll.timeout = null;
                    maybePoll();
                } else {
                    fileState.poll.timeout = createTimeout(
                        maybePoll,
                        fileState.poll.time - currentTime,
                    );
                }
            }
        };

        assert(fileState.unsubscribeFromStore === null);
        assert(fileState.expirationTimeout === null);
        assert(fileState.refreshTimeout === null);
        assert(fileState.poll === null || fileState.poll.timeout === null);

        fileState.unsubscribeFromStore = fileStore.subscribe(update);
        update();
    }
}

function mergeFileModelRegistryData(
    oldFileData: FileModelRegistryData,
    newFileData: FileModelRegistryData,
): FileModelRegistryData {
    const signedUrlSearch = mergeContentReferencesFileSignedUrlSearches(
        oldFileData.signedUrlSearch,
        newFileData.signedUrlSearch,
    );

    const fileData = minFileModelDataLoadingCount(oldFileData, newFileData);

    if (signedUrlSearch === oldFileData.signedUrlSearch && fileData === oldFileData) {
        return oldFileData;
    }

    if (signedUrlSearch === newFileData.signedUrlSearch && fileData === newFileData) {
        return newFileData;
    }

    return {
        ...fileData,
        signedUrlSearch,
        isSignedUrlExpired:
            newFileData.signedUrlSearch === signedUrlSearch
                ? newFileData.isSignedUrlExpired
                : oldFileData.isSignedUrlExpired,
    };
}
