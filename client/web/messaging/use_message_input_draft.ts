import {Memo, useEffect, useMemo, useRef} from "react";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {MessageInputDraftSyncState} from "~/client/web/messaging/message_input_draft_sync_state.js";
import {sendRpcNavigatorBeacon} from "~/client/web/rpc/send_rpc_navigator_beacon.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {getSynchronizedSystemClock} from "~/client/web/tracer/synchronized_system_clock.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {Clock} from "~/shared/helpers/clock/clock.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {
    MessageDraft,
    MessageDraftWithFiles,
    isMessageDraftWithHydratedFiles,
} from "~/shared/messaging/message_draft_schema.js";
import {
    MessageDraftSurface,
    MessageDraftSurfaceKey,
    getMessageDraftSurfaceKey,
} from "~/shared/messaging/message_draft_surface.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {
    clearMessageDraft,
    getMessageDraftFiles,
    updateMessageDraft,
} from "~/shared/rpc/message_drafts_rpc_definitions.js";

type MessageDraftWriteOperation =
    | {
          type: "Update";
          surface: MessageDraftSurface;
          surfaceKey: MessageDraftSurfaceKey;
          state: ContentEditorState<MessageContentWithReferences>;
          parent: MessageContentPayloadParent | null;
          fileIds: ReadonlyArray<FileId | FileEntityId>;
          version: HybridLogicalTime;
      }
    | {
          type: "Clear";
          surface: MessageDraftSurface;
          surfaceKey: MessageDraftSurfaceKey;
      };

/**
 * Resolves a server draft for `<MessageInput>` and persists local edits back to
 * the account's server-side message draft for a surface.
 *
 * Loaders may provide a lite draft (`fileIds` only). When needed, file models are
 * lazy-loaded before the input applies the draft. Debounced writes, clears, and
 * unmount flushes happen from local input state. When the page is hidden (e.g. the
 * user closes the tab) the final draft is saved with `navigator.sendBeacon()`.
 */
export function useMessageInputDraft({
    draftSurface,
    serverDraft,
    inputState,
    parent,
    fileIds,
    draftSyncState,
    hasLocalDraftContent,
    isDisabled,
    shouldFlushOnUnmount,
    draftContentWriteDebounceMs,
}: {
    draftSurface?: MessageDraftSurface;
    serverDraft?: MessageDraft | MessageDraftWithFiles;
    inputState: ContentEditorState<MessageContentWithReferences>;
    parent: MessageContentPayloadParent | null;
    fileIds: ReadonlyArray<FileId | FileEntityId>;
    draftSyncState: MessageInputDraftSyncState | null;
    hasLocalDraftContent: boolean;
    isDisabled: boolean;
    shouldFlushOnUnmount: boolean;
    draftContentWriteDebounceMs: number;
}): {
    resolvedServerDraft: MessageDraftWithFiles | undefined;
    flushDraft: Memo<() => void>;
    clearDraft: Memo<() => void>;
    clearDraftOptimistically: Memo<(sendPromise: Promise<unknown>) => void>;
} {
    const context = useAppContext();
    const reporter = useReporter();
    const {
        currentAccount,
        space: {id: spaceId},
    } = useSpaceContext();

    const needsFileHydration =
        serverDraft !== undefined &&
        serverDraft.fileIds.length > 0 &&
        !isMessageDraftWithHydratedFiles(serverDraft);
    const {output: hydratedFilesOutput} = useLazyLoadRpc(
        getMessageDraftFiles,
        needsFileHydration && draftSurface
            ? {spaceId, surface: draftSurface, fileIds: serverDraft.fileIds}
            : null,
    );

    const resolvedServerDraft: MessageDraftWithFiles | undefined = useMemo(() => {
        if (!serverDraft) return undefined;
        if (needsFileHydration) {
            return hydratedFilesOutput
                ? {...serverDraft, files: hydratedFilesOutput.files}
                : undefined;
        }
        if (isMessageDraftWithHydratedFiles(serverDraft)) return serverDraft;
        return {...serverDraft, files: emptyArray};
    }, [serverDraft, needsFileHydration, hydratedFilesOutput]);

    // Whether the server still has a non-empty draft row for this surface. Used to
    // decide when local input becomes empty we should call `clearMessageDraft`.
    // Distinct from `lastDraftSentRef`: this is only "does a row exist?" not the row's
    // content.
    const hasRemoteDraftContentRef = useRef(false);

    // Pending debounced auto-save timer started by the input change effect.
    const draftSaveDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // The input content/parent we last considered synced with the server — either
    // because mount hydration provided it via `draftSyncState` or we successfully
    // queued a write. Skips redundant update RPCs when nothing changed. Reset on
    // failed saves and when clearing so the next edit re-triggers a write.
    const lastDraftSentRef = useRef<{
        state: ContentEditorState<MessageContentWithReferences>;
        parent: MessageContentPayloadParent | null;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
    } | null>(null);

    const draftWriteVersionClock = useMemo(() => createMessageDraftVersionClock(), []);

    // The in-flight write promise, if any. Only one RPC runs at a time; further
    // operations wait in `queuedDraftWriteOperationsRef`.
    const pendingDraftWriteRef = useRef<Promise<void> | null>(null);

    // Pending update/clear operations not yet sent. Coalesced by surface key so a
    // burst of edits becomes one update with the latest content.
    const queuedDraftWriteOperationsRef = useRef<Array<MessageDraftWriteOperation>>([]);

    const hasAccessibleDraftSurface = draftSurface && currentAccount ? draftSurface : null;

    const cancelDraftSaveDebounce = useEvent(() => {
        if (draftSaveDebounceTimeoutRef.current !== null) {
            clearTimeout(draftSaveDebounceTimeoutRef.current);
            draftSaveDebounceTimeoutRef.current = null;
        }
    });

    const isInputUnchangedSinceLastSend = useEvent(
        () =>
            lastDraftSentRef.current?.state === inputState &&
            isDeepEqual(lastDraftSentRef.current.parent, parent) &&
            isDeepEqual(lastDraftSentRef.current.fileIds, fileIds),
    );

    useEffect(() => {
        lastDraftSentRef.current = draftSyncState?.lastDraftSent ?? null;
        hasRemoteDraftContentRef.current = draftSyncState?.hasRemoteDraftContent ?? false;
        if (serverDraft) draftWriteVersionClock.tick(serverDraft.version);
    }, [draftSyncState, draftSurface, draftWriteVersionClock, serverDraft]);

    const clearDraft = useEvent(() => {
        cancelDraftSaveDebounce();

        if (!hasAccessibleDraftSurface) return;

        lastDraftSentRef.current = null;
        hasRemoteDraftContentRef.current = false;

        enqueueDraftWriteOperation({
            type: "Clear",
            surface: hasAccessibleDraftSurface,
            surfaceKey: getMessageDraftSurfaceKey(hasAccessibleDraftSurface),
        });
    });

    const clearDraftOptimistically = useEvent((sendPromise: Promise<unknown>) => {
        cancelDraftSaveDebounce();

        // Forget the draft locally so the now-empty input doesn't eagerly clear the server
        // draft. We keep the server row until the message actually sends so a failed send
        // still restores the draft on reload.
        lastDraftSentRef.current = null;
        hasRemoteDraftContentRef.current = false;

        // Commit the clear to the server once the send resolves. If the send fails we
        // leave the server draft intact.
        sendPromise.then(
            () => {
                clearDraft();
            },
            () => {},
        );
    });

    const maybeClearRemoteDraftWhenInputEmpty = useEvent(() => {
        if (hasLocalDraftContent) return false;
        if (hasRemoteDraftContentRef.current) clearDraft();
        return true;
    });

    const processNextDraftWriteOperation = useEvent(() => {
        if (pendingDraftWriteRef.current !== null) return;

        const operation = queuedDraftWriteOperationsRef.current.shift();
        if (!operation) return;

        const promise = (async () => {
            switch (operation.type) {
                case "Update": {
                    await updateMessageDraft(context, {
                        spaceId,
                        surface: operation.surface,
                        content: operation.state.getDoc(),
                        parent: operation.parent,
                        fileIds: operation.fileIds,
                        version: operation.version,
                    });
                    break;
                }
                case "Clear": {
                    await clearMessageDraft(context, {spaceId, surface: operation.surface});
                    break;
                }
                default:
                    throw exhaustive(operation);
            }
        })()
            .catch(error => {
                switch (operation.type) {
                    case "Update": {
                        lastDraftSentRef.current = null;
                        reporter.logErrorWithoutDisplaying(
                            "Couldn\u2019t save message draft",
                            error,
                        );
                        break;
                    }
                    case "Clear": {
                        hasRemoteDraftContentRef.current = true;
                        reporter.logErrorWithoutDisplaying(
                            "Couldn\u2019t clear message draft",
                            error,
                        );
                        break;
                    }
                    default:
                        throw exhaustive(operation);
                }
            })
            .finally(() => {
                if (pendingDraftWriteRef.current === promise) {
                    pendingDraftWriteRef.current = null;
                }
                processNextDraftWriteOperation();
            });

        pendingDraftWriteRef.current = promise;
    });

    const enqueueDraftWriteOperation = useEvent((operation: MessageDraftWriteOperation) => {
        const existingOperationIndex = queuedDraftWriteOperationsRef.current.findIndex(
            queuedOperation => queuedOperation.surfaceKey === operation.surfaceKey,
        );
        if (existingOperationIndex === -1) {
            queuedDraftWriteOperationsRef.current.push(operation);
        } else {
            queuedDraftWriteOperationsRef.current[existingOperationIndex] = operation;
        }

        processNextDraftWriteOperation();
    });

    const getPendingDraftWriteOperation = useEvent((): MessageDraftWriteOperation | null => {
        if (!hasAccessibleDraftSurface || isDisabled) return null;

        if (!hasLocalDraftContent) {
            if (!hasRemoteDraftContentRef.current) return null;
            return {
                type: "Clear",
                surface: hasAccessibleDraftSurface,
                surfaceKey: getMessageDraftSurfaceKey(hasAccessibleDraftSurface),
            };
        }

        if (isInputUnchangedSinceLastSend()) return null;

        return {
            type: "Update",
            surface: hasAccessibleDraftSurface,
            surfaceKey: getMessageDraftSurfaceKey(hasAccessibleDraftSurface),
            state: inputState,
            parent,
            fileIds,
            version: draftWriteVersionClock.now(),
        };
    });

    const flushDraft = useEvent(() => {
        cancelDraftSaveDebounce();

        const operation = getPendingDraftWriteOperation();
        if (!operation) return;

        switch (operation.type) {
            case "Update": {
                lastDraftSentRef.current = {state: inputState, parent, fileIds};
                hasRemoteDraftContentRef.current = true;
                break;
            }
            case "Clear": {
                lastDraftSentRef.current = null;
                hasRemoteDraftContentRef.current = false;
                break;
            }
            default:
                throw exhaustive(operation);
        }

        enqueueDraftWriteOperation(operation);
    });

    useEffect(() => {
        if (!hasAccessibleDraftSurface || isDisabled) return;

        const handleVisibilityChange = () => {
            if (document.visibilityState !== "hidden") return;

            cancelDraftSaveDebounce();

            const operation = getPendingDraftWriteOperation();
            if (!operation) return;

            switch (operation.type) {
                case "Update": {
                    lastDraftSentRef.current = {
                        state: operation.state,
                        parent: operation.parent,
                        fileIds: operation.fileIds,
                    };
                    hasRemoteDraftContentRef.current = true;

                    // Flush with sendBeacon so the save can outlive page unload. Beacon requests can't
                    // be retried or inspected for errors, so we only use this on visibility hidden;
                    // debounced and unmount flushes use the normal RPC path.
                    sendRpcNavigatorBeacon(updateMessageDraft, {
                        spaceId,
                        surface: operation.surface,
                        content: operation.state.getDoc(),
                        parent: operation.parent,
                        fileIds: operation.fileIds,
                        version: operation.version,
                    });
                    break;
                }
                case "Clear": {
                    lastDraftSentRef.current = null;
                    hasRemoteDraftContentRef.current = false;

                    // Flush with sendBeacon so the save can outlive page unload. Beacon requests can't
                    // be retried or inspected for errors, so we only use this on visibility hidden;
                    // debounced and unmount flushes use the normal RPC path.
                    sendRpcNavigatorBeacon(clearMessageDraft, {
                        spaceId,
                        surface: operation.surface,
                    });
                    break;
                }
                default:
                    throw exhaustive(operation);
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [
        cancelDraftSaveDebounce,
        getPendingDraftWriteOperation,
        hasAccessibleDraftSurface,
        isDisabled,
        spaceId,
    ]);

    useEffect(() => {
        if (!hasAccessibleDraftSurface || isDisabled) return;
        if (maybeClearRemoteDraftWhenInputEmpty()) return;
        if (isInputUnchangedSinceLastSend()) return;

        cancelDraftSaveDebounce();
        draftSaveDebounceTimeoutRef.current = setTimeout(() => {
            draftSaveDebounceTimeoutRef.current = null;
            flushDraft();
        }, draftContentWriteDebounceMs);

        return cancelDraftSaveDebounce;
    }, [
        hasAccessibleDraftSurface,
        cancelDraftSaveDebounce,
        draftContentWriteDebounceMs,
        flushDraft,
        fileIds,
        hasLocalDraftContent,
        inputState,
        isDisabled,
        isInputUnchangedSinceLastSend,
        maybeClearRemoteDraftWhenInputEmpty,
        parent,
    ]);

    useEffect(() => {
        if (!shouldFlushOnUnmount) return;
        return () => {
            flushDraft();
        };
    }, [shouldFlushOnUnmount, flushDraft]);

    return {resolvedServerDraft, flushDraft, clearDraft, clearDraftOptimistically};
}

function createMessageDraftVersionClock() {
    const synchronizedSystemClockPromise = getSynchronizedSystemClock();
    let synchronizedSystemClock: Clock | null = null;

    return new HybridLogicalClock({
        now: () => {
            if (synchronizedSystemClock !== null) return synchronizedSystemClock.now();

            const synchronizedSystemClockPromiseState =
                synchronizedSystemClockPromise.getStateWithoutListening();

            if (synchronizedSystemClockPromiseState.status === "fulfilled") {
                synchronizedSystemClock = synchronizedSystemClockPromiseState.value;
                return synchronizedSystemClockPromiseState.value.now();
            }

            return unsynchronizedSystemClock.now();
        },
    });
}
