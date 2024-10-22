import {useEffect, useMemo, useRef, useState} from "react";
import {ContentFileDesktopViewerModal} from "~/client/content/internal/content_file_desktop_viewer_modal.js";
import {ContentFileMobileViewerModal} from "~/client/content/internal/content_file_mobile_viewer_modal.js";
import {
    ContentFileViewerLoaderData,
    loadContentFileViewerData,
} from "~/client/content/internal/load_content_file_viewer_data.js";
import {ContentFilePreviewExpirationTimers} from "~/client/content/internal/render_content_file_preview.js";
import {useAppContext} from "~/client/context/app_context.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useConstant} from "~/client/helpers/lifecycle/use_constant.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useForceRevalidateRpc, useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {
    PromiseImmediateResolver,
    createPromiseImmediateResolver,
} from "~/shared/helpers/async/promise_immediate_resolver.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {getFileFromAttachment} from "~/shared/rpc/files_rpc_definitions.js";

let handoffContentFileReferencesByFileId: Map<
    FileId,
    Set<{signedUrlSearch: string; file: FileModel}>
> | null = null;

/**
 * Handoff some previously loaded data to `<ContentFileDesktopViewerModal>` so
 * it doesn't have to fetch data from the server when it mounts.
 */
function handoffContentFileReference(reference: {signedUrlSearch: string; file: FileModel}) {
    handoffContentFileReferencesByFileId ??= new Map();

    const handoffContentFileReferences = getOrSetDefaultMapValue(
        handoffContentFileReferencesByFileId,
        reference.file.id,
        () => new Set(),
    );

    if (handoffContentFileReferences.has(reference)) return;

    handoffContentFileReferences.add(reference);

    setTimeout(() => {
        handoffContentFileReferences.delete(reference);

        if (handoffContentFileReferences.size === 0)
            handoffContentFileReferencesByFileId?.delete(reference.file.id);
    }, 1000);
}

export function ContentFileViewerModal({
    fileId,
    attachmentTarget,
    onClose,
}: {
    fileId: FileId;
    attachmentTarget: FileAttachmentTarget;
    onClose: () => void;
}) {
    const context = useAppContext();
    const isMobile = useIsMobile();
    const {space} = useSpaceContext();

    const handoffFileReference = useConstant(() =>
        iterableFirst(handoffContentFileReferencesByFileId?.get(fileId) ?? emptyArray),
    );

    const fileFromAttachmentInput = useMemo(
        () => ({
            spaceId: space.id,
            fileId,
            target: attachmentTarget,
        }),
        [attachmentTarget, fileId, space.id],
    );

    const fileFromAttachmentOutput = useLazyLoadRpc(
        getFileFromAttachment,
        fileFromAttachmentInput,
        {
            initialOutput: handoffFileReference?.file.id === fileId ? handoffFileReference : null,
            // File data is immutable after it finishes loading. Don't automatically
            // revalidate whenever the browser becomes visible after being hidden.
            withoutAutomaticRevalidation: true,
        },
    );

    const forceRevalidateRpc = useForceRevalidateRpc();

    const [expirationTimers] = useState(() => new ContentFilePreviewExpirationTimers());

    const isFileLoading: boolean =
        !!fileFromAttachmentOutput.output?.file && fileFromAttachmentOutput.output.file.isLoading();

    // Poll while the file is loading so when the file finishes loading we can
    // render it in realtime. Matches the polling behavior in
    // `addContentFilePreviewBehavior()`. Once the file finishes loading it's
    // immutable.
    useEffect(() => {
        if (!isFileLoading) return;

        let pollCount = 0;
        let pollErrorCount = 0;
        let pollTimeout: Timeout | null = null;

        const schedulePoll = () => {
            assert(pollTimeout === null);

            // Increase the poll duration exponentially until we're polling every ~5s.
            pollTimeout = createTimeout(poll, 500 + 2 ** Math.min(pollCount, 12));
        };

        const poll = () => {
            pollTimeout = null;
            pollCount++;

            forceRevalidateRpc(getFileFromAttachment, fileFromAttachmentInput).then(
                ({file: newFile}) => {
                    if (newFile.isLoading()) {
                        schedulePoll();
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

        return () => {
            pollTimeout?.clear();
            pollTimeout = null;
        };
    }, [context.tracer, fileFromAttachmentInput, forceRevalidateRpc, isFileLoading]);

    // When the signed URL is about to expire we need to refresh it. This matches
    // similar logic in `addContentFilePreviewBehavior()` which refreshes the
    // signed URL when it's about to expire.
    useEffect(() => {
        if (!fileFromAttachmentOutput.output?.signedUrlSearch) return;

        const refreshTimerStore = expirationTimers.getRefreshTimerStore(
            fileFromAttachmentOutput.output.signedUrlSearch,
        );

        const refresh = () => {
            // Ignore promise. Results and errors will be handled by the `useLazyLoadRpc()`
            // hook consuming this data.
            void forceRevalidateRpc(getFileFromAttachment, fileFromAttachmentInput);
        };

        let unsubscribeFromRefreshTimer: (() => void) | null = null;

        if (refreshTimerStore.getSnapshot()) {
            refresh();
        } else {
            unsubscribeFromRefreshTimer = refreshTimerStore.subscribe(() => {
                if (!refreshTimerStore.getSnapshot()) return;

                unsubscribeFromRefreshTimer?.();
                unsubscribeFromRefreshTimer = null;

                refresh();
            });
        }

        return () => {
            unsubscribeFromRefreshTimer?.();
            unsubscribeFromRefreshTimer = null;
        };
    }, [
        expirationTimers,
        fileFromAttachmentInput,
        fileFromAttachmentOutput.output?.signedUrlSearch,
        forceRevalidateRpc,
    ]);

    const [loaderDataPromiseResolver] = useStateWithDependencies(
        () => createPromiseImmediateResolver<ContentFileViewerLoaderData | null>(),
        [fileId],
    );

    const loadedLoaderDataPromiseResolverRef =
        useRef<PromiseImmediateResolver<ContentFileViewerLoaderData | null> | null>(null);

    // Load any data needed to render the file viewer modal. We will delay opening
    // the file viewer modal for a bit so if the network is fast we don't need to
    // show a loading spinner.
    useEffect(() => {
        if (!fileFromAttachmentOutput.output) return;

        if (loadedLoaderDataPromiseResolverRef.current === loaderDataPromiseResolver) return;
        loadedLoaderDataPromiseResolverRef.current = loaderDataPromiseResolver;

        loadContentFileViewerData({
            spaceId: space.id,
            signedUrlSearch: fileFromAttachmentOutput.output.signedUrlSearch,
            file: fileFromAttachmentOutput.output.file,
        }).then(loaderDataPromiseResolver.resolve, loaderDataPromiseResolver.reject);
    }, [fileFromAttachmentOutput.output, loaderDataPromiseResolver, space.id]);

    const [delayState, setDelayState] = useState<{startTime: number} | null>(() => ({
        startTime: Date.now(),
    }));

    // Wait for either:
    //
    // 1. `loaderData.promise` to resolve; OR
    // 2. For `delayScreenTransitionLoadingIndicatorLimitMs` to elapse
    //
    // Whichever happens first.
    useEffect(() => {
        if (!delayState) return;
        if (!fileFromAttachmentOutput.output) return;

        let hasCleanedUp = false;

        Promise.race([
            wait(delayState.startTime + delayScreenTransitionLoadingIndicatorLimitMs - Date.now()),
            loaderDataPromiseResolver.promise,
        ]).then(
            () => {
                if (hasCleanedUp) return;
                setDelayState(null);
            },
            () => {
                if (hasCleanedUp) return;
                setDelayState(null);
            },
        );

        return () => {
            hasCleanedUp = true;
        };
    }, [delayState, fileFromAttachmentOutput.output, loaderDataPromiseResolver?.promise]);

    if (!fileFromAttachmentOutput.output || !loaderDataPromiseResolver || delayState) return null;

    if (isMobile) {
        return (
            <ContentFileMobileViewerModal
                file={fileFromAttachmentOutput.output.file}
                signedUrlSearch={fileFromAttachmentOutput.output.signedUrlSearch}
                attachmentTarget={attachmentTarget}
                expirationTimers={expirationTimers}
                loaderDataPromise={loaderDataPromiseResolver.promise}
                onClose={onClose}
            />
        );
    } else {
        return (
            <ContentFileDesktopViewerModal
                file={fileFromAttachmentOutput.output.file}
                signedUrlSearch={fileFromAttachmentOutput.output.signedUrlSearch}
                attachmentTarget={attachmentTarget}
                expirationTimers={expirationTimers}
                loaderDataPromise={loaderDataPromiseResolver.promise}
                onClose={onClose}
            />
        );
    }
}

ContentFileViewerModal.handoffFileReference = handoffContentFileReference;
