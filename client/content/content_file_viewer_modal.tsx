import {useEffect, useMemo, useRef, useState} from "react";
import {useFileRegistry} from "~/client/content/file_registry_context.js";
import {ContentFileViewerModalDesktop} from "~/client/content/internal/content_file_viewer_modal_desktop.js";
import {ContentFileViewerModalMobile} from "~/client/content/internal/content_file_viewer_modal_mobile.js";
import {useHandoffContentFilePreviewState} from "~/client/content/internal/handoff_content_file_preview_state.js";
import {
    ContentFileViewerLoaderData,
    loadContentFileViewerData,
} from "~/client/content/internal/load_content_file_viewer_data.js";
import {useAppContext} from "~/client/context/app_context.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useErrorState} from "~/client/helpers/use_error_state.js";
import {useStore} from "~/client/helpers/use_store.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    PromiseImmediateResolver,
    createPromiseImmediateResolver,
} from "~/shared/helpers/async/promise_immediate_resolver.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {getFileAsUploader, getFileFromAttachment} from "~/shared/rpc/files_rpc_definitions.js";
import {nullStore} from "~/shared/store/const_store.js";

export function ContentFileViewerModal({
    fileId,
    attachmentTarget,
    onClose,
}: {
    fileId: FileId;
    attachmentTarget: FileAttachmentTarget | "Uploader";
    onClose: () => void;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const {space} = useSpaceContext();
    const fileRegistry = useFileRegistry();

    const handoffFilePreviewState = useHandoffContentFilePreviewState(fileId);

    const [fileReference, setFileReference] = useState<{
        signedUrlSearch: string;
        file: FileModel;
    } | null>(handoffFilePreviewState ?? null);

    const setErrorState = useErrorState();
    const hasFetchedFileReferenceRef = useRef(false);

    // If we don't have a `fileReference` loaded then fetch one. If opening a file
    // viewer from a file preview then we should immediately have a `fileReference`
    // available through `useHandoffContentFilePreviewState()`. So this code only
    // really runs if the page reloads and there's an attachment viewer open
    // according to the URL.
    useEffect(() => {
        if (fileReference) {
            hasFetchedFileReferenceRef.current = false;
            return;
        }

        if (hasFetchedFileReferenceRef.current) return;
        hasFetchedFileReferenceRef.current = true;

        (attachmentTarget === "Uploader"
            ? getFileAsUploader(context, {
                  spaceId: space.id,
                  fileId,
              })
            : getFileFromAttachment(context, {
                  spaceId: space.id,
                  fileId,
                  target: attachmentTarget,
              })
        ).then(setFileReference, setErrorState);
    }, [
        attachmentTarget,
        context,
        fileId,
        fileReference,
        handoffFilePreviewState,
        setErrorState,
        space.id,
    ]);

    const file = useStore(
        useMemo(
            () => (fileReference ? fileRegistry.getFileStore(fileReference) : nullStore),
            [fileReference, fileRegistry],
        ),
    );

    useEffect(() => {
        if (!fileReference) return;
        return fileRegistry.startMaintainingFile(() => context, fileReference, attachmentTarget);
    }, [attachmentTarget, context, fileReference, fileRegistry]);

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
        if (!file) return;

        if (loadedLoaderDataPromiseResolverRef.current === loaderDataPromiseResolver) return;
        loadedLoaderDataPromiseResolverRef.current = loaderDataPromiseResolver;

        loadContentFileViewerData({spaceId: space.id, file, platform}).then(
            loaderDataPromiseResolver.resolve,
            loaderDataPromiseResolver.reject,
        );
    }, [file, loaderDataPromiseResolver, platform, space.id]);

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
        if (!file) return;

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
    }, [delayState, file, loaderDataPromiseResolver.promise]);

    return (
        <>
            {!file || !loaderDataPromiseResolver || delayState ? null : platform === "mobile" ? (
                <ContentFileViewerModalMobile
                    file={file}
                    ownedByElement={handoffFilePreviewState?.ownedByElement ?? null}
                    loaderDataPromise={loaderDataPromiseResolver.promise}
                    onClose={onClose}
                />
            ) : (
                <ContentFileViewerModalDesktop
                    file={file}
                    attachmentTarget={attachmentTarget}
                    ownedByElement={handoffFilePreviewState?.ownedByElement ?? null}
                    loaderDataPromise={loaderDataPromiseResolver.promise}
                    onClose={onClose}
                />
            )}
        </>
    );
}
