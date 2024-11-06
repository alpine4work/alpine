import {useEffect, useMemo, useRef, useState} from "react";
import {useContentFilePreviewExpirationTimers} from "~/client/content/internal/content_file_preview_expiration_timers.js";
import {ContentFileViewerModalDesktop} from "~/client/content/internal/content_file_viewer_modal_desktop.js";
import {ContentFileViewerModalMobile} from "~/client/content/internal/content_file_viewer_modal_mobile.js";
import {useHandoffContentFileReference} from "~/client/content/internal/handoff_content_file_reference.js";
import {
    ContentFileViewerLoaderData,
    loadContentFileViewerData,
} from "~/client/content/internal/load_content_file_viewer_data.js";
import {useAppContext} from "~/client/context/app_context.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useForceRevalidateRpc, useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {
    PromiseImmediateResolver,
    createPromiseImmediateResolver,
} from "~/shared/helpers/async/promise_immediate_resolver.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {getFileFromAttachment} from "~/shared/rpc/files_rpc_definitions.js";

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

    const handoffFileReference = useHandoffContentFileReference(fileId);

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

    const expirationTimers = useContentFilePreviewExpirationTimers();

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
            isMobile,
        }).then(loaderDataPromiseResolver.resolve, loaderDataPromiseResolver.reject);
    }, [fileFromAttachmentOutput.output, isMobile, loaderDataPromiseResolver, space.id]);

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

    return (
        <>
            {!fileFromAttachmentOutput.output ||
            !loaderDataPromiseResolver ||
            delayState ? null : isMobile ? (
                <ContentFileViewerModalMobile
                    file={fileFromAttachmentOutput.output.file}
                    signedUrlSearch={fileFromAttachmentOutput.output.signedUrlSearch}
                    attachmentTarget={attachmentTarget}
                    expirationTimers={expirationTimers}
                    loaderDataPromise={loaderDataPromiseResolver.promise}
                    onClose={onClose}
                />
            ) : (
                <ContentFileViewerModalDesktop
                    file={fileFromAttachmentOutput.output.file}
                    signedUrlSearch={fileFromAttachmentOutput.output.signedUrlSearch}
                    attachmentTarget={attachmentTarget}
                    expirationTimers={expirationTimers}
                    loaderDataPromise={loaderDataPromiseResolver.promise}
                    onClose={onClose}
                />
            )}
        </>
    );
}
