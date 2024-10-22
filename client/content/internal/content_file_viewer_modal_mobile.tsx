import {DownloadSimple, Export, Lock, SpinnerGap, X} from "phosphor-react";
import prettyBytes from "pretty-bytes";
import {ContentFileCodeViewer} from "~/client/content/internal/content_file_code_viewer.js";
import {ContentFileImageViewerMobile} from "~/client/content/internal/content_file_image_viewer_mobile.js";
import {getFileContentTypeName} from "~/client/content/internal/get_file_content_type_name.js";
import {ContentFileViewerLoaderData} from "~/client/content/internal/load_content_file_viewer_data.js";
import {
    ContentFilePreviewExpirationTimers,
    getContentFileDownloadName,
} from "~/client/content/internal/render_content_file_preview.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MobileFullScreenModal} from "~/client/design/mobile_full_screen_modal.js";
import {
    mobileNavigationBarGap,
    navigationBarHeight,
} from "~/client/design/navigation_bar_helpers.js";
import {Spacer} from "~/client/design/spacer.js";
import {ErrorBoundary} from "~/client/helpers/error_boundary.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    spaceLayoutErrorRendererPaddingX,
    spaceLayoutErrorRendererPaddingY,
} from "~/client/styles/space_layout_shared_styles.js";
import {initialSelectionColorsClassName, spinAnimationClassName} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {ErrorBase, FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Render the provided file in a fullscreen modal on mobile platforms.
 *
 * IMPORTANT: If you make a change to preview rendering here you should also
 * consider making the same change to `renderContentFilePreview()` and
 * `<ContentFileViewerModalDesktop>`. We have three renderers for every file
 * type. The inline preview, the fullscreen desktop modal, and the fullscreen
 * mobile modal. They should all look and behave about the same.
 */
export function ContentFileViewerModalMobile({
    file,
    signedUrlSearch,
    attachmentTarget,
    expirationTimers,
    loaderDataPromise,
    onClose,
}: {
    file: FileModel;
    signedUrlSearch: string;
    attachmentTarget: FileAttachmentTarget;
    expirationTimers: ContentFilePreviewExpirationTimers;
    loaderDataPromise: PromiseImmediate<ContentFileViewerLoaderData | null>;
    onClose: () => void;
}) {
    const {space} = useSpaceContext();

    const [navigationBarRef, navigationBarSize] = useResizeObserver({
        // Don't use the `getBoundingClientRect` method because the dimensions will be
        // affected by the modal's fade in animation which scales the modal element.
        method: "clientWidthAndHeight",
    });

    const [viewerRef, viewerSize] = useResizeObserver({
        // Don't use the `getBoundingClientRect` method because the dimensions will be
        // affected by the modal's fade in animation which scales the modal element.
        method: "clientWidthAndHeight",
    });

    const onShare = async () => {
        let url: string | undefined;

        if (file.alternative && !file.alternative.isProcessing) {
            url = `/files/${space.id}/${file.id}${signedUrlSearch}&variant=${
                file.alternative.isImagePreviewContent ? "preview" : "alternative"
            }`;
        } else if (!file.alternative && !file.isUploading) {
            url = `/files/${space.id}/${file.id}${signedUrlSearch}`;
        }

        if (!url) {
            throw new FailedPreconditionError("File hasn't finished uploading", {
                displayMessage: errorDisplayMessage`The file hasn’t finished uploading. Wait a few seconds then try again.`,
            });
        }

        // eslint-disable-next-line no-global-fetch
        const response = await fetch(url);

        if (!response.ok) {
            throw new InternalError(
                `File download request failed with status code ${response.status}`,
            );
        }

        const contentType = response.headers.get("content-type");
        if (!contentType) {
            throw new InternalError(`File download request is missing "Content-Type" header`);
        }

        const blob = await response.blob();

        // Don't treat button as pending while waiting for the user to share.
        runPromiseWithoutAwaiting(async () => {
            try {
                await navigator.share({
                    files: [
                        new File([blob], getContentFileDownloadName(file), {
                            type: contentType,
                        }),
                    ],
                });
            } catch (error) {
                // If the user closes the share dialog without sharing then we get the error:
                // "AbortError: Abort due to cancellation of share." Ignore abort errors. It's
                // completely fine for the user to cancel.
                if (!(error instanceof Error) || error.name !== "AbortError") {
                    throw error;
                }
            }
        });
    };

    const withProcessingIndicator =
        file.isLoading() &&
        // If the file has an image preview where the size or placeholder are
        // processing then we'll be showing a large spinner in the center of the entire
        // modal so we don't need to also show a small spinner here.
        !(
            file.preview?.type === "Image" &&
            (file.preview.size === "Processing" || file.preview.placeholder === "Processing")
        ) &&
        // If the file has a code preview where the preview is
        // processing then we'll be showing a large spinner in the center of the entire
        // modal so we don't need to also show a small spinner here.
        !(file.preview?.type === "Code" && file.preview.isProcessing);

    return (
        <MobileFullScreenModal onClose={onClose}>
            {({isAnimating: isModalAnimating, onCloseWithAnimation}) => (
                <Box
                    position="relative"
                    width="full"
                    height="full"
                    overflow="hidden"
                    backgroundColor={{light: "grey-70-const", dark: "grey-80-const"}}
                >
                    <Box
                        ref={navigationBarRef}
                        zIndex="10"
                        position="absolute"
                        top="0"
                        left="0"
                        right="0"
                        paddingTop="safe-area-inset"
                    >
                        <Box
                            zIndex="-10"
                            position="absolute"
                            inset="0"
                            backgroundColor={{light: "grey-70-const", dark: "grey-80-const"}}
                            opacity="80"
                        />
                        <Box
                            height={navigationBarHeight}
                            paddingX={mobileNavigationBarGap}
                            gap={mobileNavigationBarGap}
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                        >
                            <IconButton
                                variant="quiet-above-content-file-viewer-modal"
                                description="Close"
                                withoutTooltip
                                onPress={() => onCloseWithAnimation()}
                            >
                                <X />
                            </IconButton>
                            <Box
                                display="flex"
                                gap="1.5"
                                style={{
                                    // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                                    // have `min-width: auto` which extends with content.
                                    // https://stackoverflow.com/a/66689926/1568890
                                    minWidth: 0,
                                }}
                            >
                                {withProcessingIndicator && <Spacer space="4" />}
                                <Box
                                    fontStyle="truncate"
                                    color={{light: "grey-20-const", dark: "grey-30-const"}}
                                >
                                    {getFileContentTypeName(file.contentType)} -{" "}
                                    {prettyBytes(file.contentLength)}
                                </Box>
                                {withProcessingIndicator && (
                                    <Box color={{light: "grey-30-const", dark: "grey-40-const"}}>
                                        <SpinnerGap
                                            className={spinAnimationClassName}
                                            size={spacing["4"]}
                                        />
                                    </Box>
                                )}
                            </Box>
                            <IconButton
                                variant="quiet-above-content-file-viewer-modal"
                                description="Share"
                                withoutTooltip
                                pressErrorTitle={`Couldn’t share ${getFileContentTypeNoun(
                                    file.contentType,
                                )}`}
                                isDisabled={
                                    file.alternative
                                        ? file.alternative.isProcessing
                                        : file.isUploading
                                }
                                onPress={onShare}
                            >
                                <Export />
                            </IconButton>
                        </Box>
                    </Box>
                    <Box
                        ref={viewerRef}
                        zIndex="0"
                        position="relative"
                        width="full"
                        height="full"
                        overflow="hidden"
                    >
                        <ErrorBoundary
                            fallback={({error}) => (
                                <Box
                                    width="full"
                                    height="full"
                                    paddingX={spaceLayoutErrorRendererPaddingX}
                                    paddingTop="safe-area-inset"
                                >
                                    <Spacer space={navigationBarHeight} />
                                    <Spacer space={spaceLayoutErrorRendererPaddingY} />
                                    {error instanceof ErrorBase &&
                                    error.code === ErrorCode.PermissionDenied ? (
                                        <ErrorBodyRenderer
                                            icon={<Lock weight="bold" />}
                                            title={`Protected ${getFileContentTypeNoun(
                                                file.contentType,
                                            )}`}
                                            error={error}
                                            colorSchemeOverride="dark"
                                        />
                                    ) : (
                                        <ErrorBodyRenderer
                                            title={`Couldn’t open ${getFileContentTypeNoun(
                                                file.contentType,
                                            )}`}
                                            error={error}
                                            colorSchemeOverride="dark"
                                        />
                                    )}
                                    <Spacer space="5" />
                                    <Button
                                        variant="neutral"
                                        icon={<DownloadSimple />}
                                        iconGap="1.5"
                                        isDisabled={
                                            file.alternative
                                                ? file.alternative.isProcessing
                                                : file.isUploading
                                        }
                                        pressErrorTitle={`Couldn’t download ${getFileContentTypeNoun(
                                            file.contentType,
                                        )}`}
                                        onPress={onShare}
                                    >
                                        Download
                                    </Button>
                                </Box>
                            )}
                        >
                            {navigationBarSize && viewerSize && (
                                <ContentFileViewerMobile
                                    file={file}
                                    signedUrlSearch={signedUrlSearch}
                                    attachmentTarget={attachmentTarget}
                                    expirationTimers={expirationTimers}
                                    loaderDataPromise={loaderDataPromise}
                                    isModalAnimating={isModalAnimating}
                                    navigationBarSize={navigationBarSize}
                                    viewerSize={viewerSize}
                                    onShare={onShare}
                                />
                            )}
                        </ErrorBoundary>
                    </Box>
                </Box>
            )}
        </MobileFullScreenModal>
    );
}

function ContentFileViewerMobile(props: {
    file: FileModel;
    signedUrlSearch: string;
    attachmentTarget: FileAttachmentTarget;
    expirationTimers: ContentFilePreviewExpirationTimers;
    loaderDataPromise: PromiseImmediate<ContentFileViewerLoaderData | null>;
    isModalAnimating: boolean;
    navigationBarSize: {width: number; height: number};
    viewerSize: {width: number; height: number};
    onShare: () => Promise<void>;
}) {
    switch (props.file.contentType) {
        case "application/octet-stream": {
            // TODO(calebmer, #files): Implement
            return null;
        }
        case "image/apng":
        case "image/avif":
        case "image/gif":
        case "image/jpeg":
        case "image/png":
        case "image/svg+xml":
        case "image/webp":
        case "image/bmp":
        case "image/ico":
        case "image/tiff":
        case "image/heif": {
            return <ContentFileImageViewerMobile {...props} withZoom={true} />;
        }
        case "application/pdf":
        case "application/msword":
        case "application/vnd.ms-excel":
        case "application/vnd.ms-powerpoint":
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
            // TODO(calebmer, #files): Implement
            //
            // Should start with the image viewer then switch to a proper viewer?
            return <ContentFileImageViewerMobile {...props} withZoom={false} />;
        }
        case "video/webm":
        case "video/mp4":
        case "video/quicktime":
        case "video/mpeg":
        case "video/x-matroska": {
            // TODO(calebmer, #files): Implement
            return null;
        }
        case "audio/mpeg":
        case "audio/wav":
        case "audio/webm":
        case "audio/ogg":
        case "audio/mp4": {
            // TODO(calebmer, #files): Implement
            return null;
        }
        case "text/plain":
        case "text/javascript":
        case "text/html":
        case "text/css":
        case "application/sql":
        case "text/x-python":
        case "text/x-typescript":
        case "application/x-sh":
        case "text/x-java":
        case "application/json":
        case "text/markdown":
        case "text/x-csharp":
        case "text/x-c++src":
        case "text/x-csrc":
        case "application/x-httpd-php":
        case "text/x-go":
        case "application/yaml":
        case "application/x-powershell":
        case "text/rust":
        case "text/x-kotlin":
        case "application/x-ruby":
        case "text/x-lua":
        case "application/xml":
        case "application/vnd.dart":
        case "text/x-swift":
        case "text/x-asm":
        case "application/wasm":
        case "text/x-scala":
        case "text/x-r":
        case "text/x-elixir":
        case "text/x-objcsrc":
        case "text/x-perl":
        case "text/x-haskell":
        case "text/x-solidity":
        case "text/x-clojure":
        case "text/x-erlang":
        case "text/x-ocaml": {
            return (
                <Box
                    width="full"
                    height="full"
                    userSelect={!props.file.preview?.isProcessing ? "text" : undefined}
                    style={{paddingTop: props.navigationBarSize.height}}
                >
                    <Box
                        width="full"
                        height="full"
                        backgroundColor="grey-0"
                        color="grey-100"
                        cursor={!props.file.preview?.isProcessing ? "text" : undefined}
                        overflow="hidden"
                        className={initialSelectionColorsClassName}
                    >
                        <ContentFileCodeViewer {...props} />
                    </Box>
                </Box>
            );
        }
        default:
            throw exhaustive(props.file.contentType);
    }
}
