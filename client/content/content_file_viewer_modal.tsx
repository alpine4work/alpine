import {useEffect, useRef, useState} from "react";
import {ContentFilePollerContext} from "~/client/content/internal/content_file_poller.js";
import {useContentFilePreviewExpirationTimers} from "~/client/content/internal/content_file_preview_expiration_timers.js";
import {ContentFileViewerModalDesktop} from "~/client/content/internal/content_file_viewer_modal_desktop.js";
import {ContentFileViewerModalMobile} from "~/client/content/internal/content_file_viewer_modal_mobile.js";
import {useHandoffContentFilePreviewState} from "~/client/content/internal/handoff_content_file_preview_state.js";
import {
    ContentFileViewerLoaderData,
    loadContentFileViewerData,
} from "~/client/content/internal/load_content_file_viewer_data.js";
import {useAppContext} from "~/client/context/app_context.js";
import {useGlobalContext} from "~/client/helpers/global_context.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {RpcCacheContext} from "~/client/rpc/rpc_cache.js";
import {useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {
    PromiseImmediateResolver,
    createPromiseImmediateResolver,
} from "~/shared/helpers/async/promise_immediate_resolver.js";
import {wait} from "~/shared/helpers/async/wait.js";
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
    const platform = usePlatform();
    const {space} = useSpaceContext();

    const handoffFilePreviewState = useHandoffContentFilePreviewState(fileId);

    const fileFromAttachmentOutput = useLazyLoadRpc(
        getFileFromAttachment,
        {
            spaceId: space.id,
            fileId,
            target: attachmentTarget,
        },
        {
            initialOutput:
                handoffFilePreviewState?.reference?.file.id === fileId
                    ? handoffFilePreviewState.reference
                    : null,
            // File data is immutable after it finishes loading. Don't automatically
            // revalidate whenever the browser becomes visible after being hidden.
            withoutAutomaticRevalidation: true,
        },
    );

    const cache = useGlobalContext(RpcCacheContext);
    const filePoller = useGlobalContext(ContentFilePollerContext);

    const expirationTimers = useContentFilePreviewExpirationTimers();

    const isFileLoading: boolean =
        !!fileFromAttachmentOutput.output?.file && fileFromAttachmentOutput.output.file.isLoading();

    // Poll while the file is loading so when the file finishes loading we can
    // render it in realtime. Matches the polling behavior in
    // `addContentFilePreviewBehavior()`. Once the file finishes loading it's
    // immutable.
    useEffect(() => {
        if (!isFileLoading) return;

        // We don't need to listen to `onPoll` since this function makes an RPC call
        // through `SwrCache`. So our component will re-render with the new file
        // automatically.
        return filePoller.startPolling(() => context, {
            spaceId: space.id,
            fileId,
            target: attachmentTarget,
        });
    }, [attachmentTarget, context, context.tracer, fileId, filePoller, isFileLoading, space.id]);

    // When the signed URL is about to expire we need to refresh it. This matches
    // similar logic in `addContentFilePreviewBehavior()` which refreshes the
    // signed URL when it's about to expire.
    //
    // TODO: Ideally this would behave similar to polling where we refresh all
    // files at once.
    useEffect(() => {
        if (!fileFromAttachmentOutput.output?.signedUrlSearch) return;

        const refreshTimerStore = expirationTimers.getRefreshTimerStore(
            fileFromAttachmentOutput.output.signedUrlSearch,
        );

        const refresh = () => {
            // Ignore promise. Results and errors will be handled by the `useLazyLoadRpc()`
            // hook consuming this data.
            void cache.forceRevalidate(context, getFileFromAttachment, {
                spaceId: space.id,
                fileId,
                target: attachmentTarget,
            });
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
        attachmentTarget,
        cache,
        context,
        expirationTimers,
        fileFromAttachmentOutput.output,
        fileId,
        space.id,
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
            platform,
        }).then(loaderDataPromiseResolver.resolve, loaderDataPromiseResolver.reject);
    }, [fileFromAttachmentOutput.output, loaderDataPromiseResolver, platform, space.id]);

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
            delayState ? null : platform === "mobile" ? (
                <ContentFileViewerModalMobile
                    file={fileFromAttachmentOutput.output.file}
                    signedUrlSearch={fileFromAttachmentOutput.output.signedUrlSearch}
                    attachmentTarget={attachmentTarget}
                    ownedByElement={handoffFilePreviewState?.ownedByElement ?? null}
                    expirationTimers={expirationTimers}
                    loaderDataPromise={loaderDataPromiseResolver.promise}
                    onClose={onClose}
                />
            ) : (
                <ContentFileViewerModalDesktop
                    file={fileFromAttachmentOutput.output.file}
                    signedUrlSearch={fileFromAttachmentOutput.output.signedUrlSearch}
                    attachmentTarget={attachmentTarget}
                    ownedByElement={handoffFilePreviewState?.ownedByElement ?? null}
                    expirationTimers={expirationTimers}
                    loaderDataPromise={loaderDataPromiseResolver.promise}
                    onClose={onClose}
                />
            )}
        </>
    );
}
