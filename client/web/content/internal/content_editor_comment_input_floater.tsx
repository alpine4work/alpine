import {ArrowRight, File, Image, Plus} from "phosphor-react";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    Dispatch,
    Memo,
    RefObject,
    SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {ContentBlockWidthContextProvider} from "~/client/web/content/content_block_width.js";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {ContentEditorCursorTracker} from "~/client/web/content/internal/content_editor_cursor_tracker.js";
import {
    FileInfoWithEntity,
    iterateFileInfosInElement,
} from "~/client/web/content/internal/iterate_file_infos_in_element.js";
import {
    MessageInputFile,
    addMessageInputFiles,
} from "~/client/web/content/messaging/add_message_input_files.js";
import {MessageInputFileEntityPreview} from "~/client/web/content/messaging/message_input_file_entity_preview.js";
import {MessageInputFilePreview} from "~/client/web/content/messaging/message_input_file_preview.js";
import {selectFiles} from "~/client/web/content/select_files.js";
import {
    ContentEditorState,
    createContentCommentThreadMetaKey,
    updateContentEditorReferences,
} from "~/client/web/content/state/content_editor_state.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {OverlayRef} from "~/client/web/design/overlay.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useIsMounted} from "~/client/web/helpers/lifecycle/use_is_mounted.js";
import {parseHtml} from "~/client/web/helpers/parse_html.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {VideoIcon} from "~/client/web/icons/video_icon.js";
import {WaveformIcon} from "~/client/web/icons/waveform_icon.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    messageInputEditorBorderRadiusPx,
    messageInputEditorIconButtonSize,
    messageInputEditorMinHeightPx,
    messageInputEditorPaddingX,
    messageInputEditorPaddingYPx,
    messageInputFilesOverflowGradientWidth,
    messageViewMarginLeft,
} from "~/client/web/styles/messaging_shared_styles.js";
import {
    backgroundColorVar,
    overlayFadeOutAnimationDurationMs,
    pointerEventsNoneNotInheritedClassName,
} from "~/client/web/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/content/message_content_schema.js";
import {trimContentEnd, trimContentWithReferencesEnd} from "~/shared/content/trim_content.js";
import {fileClassName, greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {
    addRemLengths,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {
    canonicalizeFileContentTypeIfExists,
    getFileAudioContentTypes,
    getFileImageContentTypes,
    getFileVideoContentTypes,
} from "~/shared/files/file_content_type.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {voidSafeFloatingPromise} from "~/shared/helpers/async/void_safe_floating_promise.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

export function ContentEditorCommentInputFloater({
    state,
    viewRef,
    range,
    fileAttachmentTarget,
    onClose: onCloseWithoutAnimationFromProps,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    onClose: () => void;
}) {
    const context = useAppContext();
    const reporter = useReporter();
    const {space} = useSpaceContext();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    // We use desktop measurements for `contentEditorCommentInputFloaterMinHeight`
    // and `contentEditorCommentInputFloaterAccountAvatarPaddingY` so assert this
    // component isn't rendered on mobile.
    const platform = usePlatform();
    assert(platform !== "mobile");

    const overlayRef = useRef<OverlayRef>(null);

    const [isClosing, setIsClosing] = useState(false);

    const onCloseWithAnimation = useCallback(() => {
        setIsClosing(true);
    }, []);

    const onCloseWithoutAnimation = useEvent(() => {
        // Return focus to the editor.
        assertExists(viewRef.current).focus();

        onCloseWithoutAnimationFromProps();
    });

    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                onCloseWithoutAnimation();
            }, overlayFadeOutAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, onCloseWithoutAnimation]);

    const isNodeRange = useMemo(() => {
        if (range.from === range.to - 1) {
            const documentRangeNode = state.doc.resolve(range.from).nodeAfter;

            if (
                documentRangeNode &&
                !documentRangeNode.inlineContent &&
                documentRangeNode.type.allowsMarkType(state.schema.marks.comment!)
            ) {
                return true;
            }
        }

        return false;
    }, [range.from, range.to, state.doc, state.schema.marks.comment]);

    const [commentState, setCommentState] = useState(() =>
        ContentEditorState.create(emptyMessageContentWithReferences),
    );
    const [files, setFiles] = useState<ReadonlyArray<MessageInputFile>>(emptyArray);

    const addFiles = (
        spanName: string,
        fileInfos: ReadonlyArray<FileInfoWithEntity>,
    ): SafeFloatingPromise<void> => {
        if (fileInfos.length === 0) return voidSafeFloatingPromise;

        const promise = context.tracer.withSpan(spanName, async context => {
            await addMessageInputFiles(context, fileInfos, {
                spaceId: space.id,
                attachmentTarget: fileAttachmentTarget,
                addGlobalLoadingIndicator,
                onAddFile: file => {
                    setFiles(files => [...files, file]);
                },
            });
        });

        promise.catch(error => {
            reporter.displayError("Couldn\u2019t upload file", error);
        });

        // It's ok if this promise floats because we render a global loading indicator.
        return promise as SafeFloatingPromise<void>;
    };

    return (
        <Box width="0" height="0">
            <OverlayAnimated
                ref={overlayRef}
                // We don't animate in because the overlay appears in direct response to a user
                // input (keyboard shortcut). But we do animate out because closing is less
                // intentional.
                //
                // Also it looks a little better to not animate when replacing a possibly
                // existing toolbar.
                isVisible={!isClosing}
                disableAnimation={!isClosing}
                isBlocking={true}
                placement="bottom"
                offset="3"
                // No fallback placements! The comment input always stays at the end of the
                // text its commenting on.
                fallbackPlacements={emptyArray}
                overlay={
                    <Box data-testid="ContentEditorCommentInputFloater">
                        <ContentEditorCommentInput
                            state={state}
                            viewRef={viewRef}
                            isNodeRange={isNodeRange}
                            range={range}
                            commentState={commentState}
                            setCommentState={setCommentState}
                            files={files}
                            setFiles={setFiles}
                            addFiles={addFiles}
                            onCloseWithoutAnimation={onCloseWithoutAnimation}
                            onCloseWithAnimation={onCloseWithAnimation}
                        />
                    </Box>
                }
            >
                <ContentEditorCursorTracker
                    state={state}
                    viewRef={viewRef}
                    pos={isNodeRange ? range.from : range}
                    onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
                />
            </OverlayAnimated>
        </Box>
    );
}

function ContentEditorCommentInput({
    state: documentState,
    viewRef: documentViewRef,
    isNodeRange: isNodeDocumentRange,
    range: documentRange,
    commentState,
    setCommentState,
    files,
    setFiles,
    addFiles,
    onCloseWithoutAnimation,
    onCloseWithAnimation,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    isNodeRange: boolean;
    range: {from: number; to: number};
    commentState: ContentEditorState<MessageContentWithReferences>;
    setCommentState: Dispatch<SetStateAction<ContentEditorState<MessageContentWithReferences>>>;
    files: ReadonlyArray<MessageInputFile>;
    setFiles: Dispatch<SetStateAction<ReadonlyArray<MessageInputFile>>>;
    addFiles: (
        spanName: string,
        fileInfos: ReadonlyArray<FileInfoWithEntity>,
    ) => SafeFloatingPromise<void>;
    onCloseWithoutAnimation: () => void;
    onCloseWithAnimation: () => void;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const {space, currentAccount} = useSpaceContext();
    const isMounted = useIsMounted();

    const [shouldShowConfirmCloseDialog, setShouldShowConfirmCloseDialog] = useState(false);

    const isSendButtonDisabled = useMemo(
        () => isContentEmpty(trimContentEnd(commentState.getDoc())) && files.length === 0,
        [commentState, files.length],
    );

    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);
    const sendButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);
    const shouldFocusNextRenderRef = useRef(true);

    useEffect(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmCloseDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        scheduleMicrotask(() => {
            const editor = editorRef.current;
            if (!editor) return;
            editor.focus({preventScroll: true});
            editor.scrollIntoView();
        });
    }, [shouldShowConfirmCloseDialog]);

    const sendComment = async () => {
        const content = trimContentWithReferencesEnd(commentState.getContent());
        if (isContentEmpty(content.doc) && files.length === 0) return;

        const commentThreadId = generateId<DocumentCommentThreadId>();
        const trimmedDocumentRange = trimSpacesFromProsemirrorRange(
            documentState.doc,
            documentRange,
        );
        const openCommentThreadPromiseRef: {current: Promise<void> | null} = {
            current: null,
        };

        const transaction = documentState.tr;

        if (isNodeDocumentRange) {
            transaction.addNodeMark(
                trimmedDocumentRange.from,
                documentState.schema.mark("comment", {commentThreadId}),
            );
        } else {
            transaction.addMark(
                trimmedDocumentRange.from,
                trimmedDocumentRange.to,
                documentState.schema.mark("comment", {commentThreadId}),
            );
        }

        transaction.setMeta(createContentCommentThreadMetaKey, {
            commentThreadId,
            initialCommentContent: content,
            initialCommentFileIds: files.map(file =>
                file.type === "FileEntity" ? file.fileEntityId : file.file.id,
            ),
            createdTimeZone: getClientInfo().timeZone,
            openCommentThreadPromiseRef,
        });

        transaction.scrollIntoView();

        updateContentEditorReferences(transaction, {
            type: "UpdateDocumentCommentThread",
            commentThreadId,
            commentCount: 1,
            addCommentAuthor: currentAccount,
        });

        assertExists(documentViewRef.current).dispatch(transaction);

        // `<DocumentContentEditor>` may open the comment thread after we create it.
        // Don't close our floater until this has happened.
        await openCommentThreadPromiseRef.current;

        onCloseWithoutAnimation();
    };

    const [dragEnterState, setDragEnterState] = useState<{
        count: number;
        hasNonTextType: boolean;
    } | null>(null);

    const [isDraggingFileWithin, setIsDraggingFileWithin] = useState(false);

    const drop = (dataTransfer: DataTransfer) => {
        let hasHtmlFileInfos = false;
        const fileInfos: Array<FileInfoWithEntity> = [];

        for (const {info} of iterateFileInfosInElement(
            parseHtml(dataTransfer.getData("text/html")),
            () => space.id,
        )) {
            if (!info) continue;

            hasHtmlFileInfos = true;
            fileInfos.push(info);
        }

        // Ignore files from `dataTransfer` if we had `text/html`. Since we assume
        // `text/html` will contain links to any files included in `dataTransfer`.
        if (!hasHtmlFileInfos) {
            for (const item of dataTransfer.items) {
                if (item.kind !== "file") continue;

                fileInfos.push({
                    type: "UploadFile",
                    input: {type: "File", file: assertExists(item.getAsFile())},
                });
            }
        }

        addFiles("<ContentEditorCommentInputFloater> drop files", fileInfos);
    };

    return (
        <>
            <Box
                ref={useMergedRefs(
                    containerRef,
                    useConfirmSaveAfterLosingFocus({
                        shouldConfirmSave: !isSendButtonDisabled,
                        isConfirmingSave: shouldShowConfirmCloseDialog,
                        onCancelSave: onCloseWithAnimation,
                        onConfirmSave: () => setShouldShowConfirmCloseDialog(true),
                    }),
                )}
                position="relative"
                width="96"
                color="grey-100"
                backgroundColor="grey-0"
                boxShadow="elevation-20"
                className={greyElevated2ClassName}
                style={{
                    borderRadius: messageInputEditorBorderRadiusPx[platform][spacingScale],
                }}
                onKeyDown={event => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (isSendButtonDisabled) {
                            onCloseWithoutAnimation();
                        } else {
                            setShouldShowConfirmCloseDialog(true);
                        }
                        return;
                    }
                }}
                onPointerDownCapture={event => {
                    const editor = assertExists(editorRef.current);

                    // Tapping anywhere on the message input shouldn't unfocus the content editor
                    // since that will hide the virtual keyboard on mobile.
                    if (
                        event.target instanceof Element &&
                        // Exclude tapping in a portaled element. Like inputs in the link modal.
                        event.currentTarget.contains(event.target) &&
                        // Exclude tapping in the message input itself. Tapping there should do
                        // something.
                        !editor.contains(event.target)
                    ) {
                        event.preventDefault();
                    }
                }}
                data-testid={
                    process.env.NODE_ENV !== "production"
                        ? "ContentEditorCommentInputDropTarget"
                        : undefined
                }
                onDragStartCapture={event => {
                    // We don't want dragging a file inside our messaging view to count as the user
                    // trying to drop the file back in the messaging view.
                    if (
                        event.target instanceof HTMLElement &&
                        event.target.closest(`.${fileClassName}`)
                    ) {
                        setIsDraggingFileWithin(true);
                    }
                }}
                onDragEndCapture={() => {
                    setIsDraggingFileWithin(false);
                }}
                onDragEnter={event => {
                    // If this drag only has `text/plain` and `text/html` it's probably because the
                    // user is dragging some content from either their browser or another app. If
                    // the user is dragging text, we want to let the message input's
                    // `<ContentEditor>` handle dropped text.
                    const hasNonTextType = event.dataTransfer.types.some(type => {
                        if (type === "Files") return true;
                        const canonicalType = canonicalizeFileContentTypeIfExists(type);
                        return canonicalType !== "text/plain" && canonicalType !== "text/html";
                    });

                    setDragEnterState(dragState => {
                        if (dragState) return {...dragState, count: dragState.count + 1};
                        return {count: 1, hasNonTextType};
                    });
                }}
                onDragLeave={() => {
                    // [Safari doesn't set `event.relatedTarget`][1] whereas Chrome does. If we
                    // reliably had access to `event.relatedTarget` we'd check:
                    // `event.currentTarget.contains(event.relatedTarget)` to know whether we need
                    // to reset our drag state.
                    //
                    // Instead we look at `dragenter` event counts. Once we reach 0 that means the
                    // user has fully dragged out of the container. We got the idea for this fix
                    // from [this Gist][2].
                    //
                    // We use this method in Chrome as well (even though we could use
                    // `event.relatedTarget`) to have consistent behavior across all browsers.
                    //
                    // [1]: https://bugs.webkit.org/show_bug.cgi?id=66547
                    // [2]: https://gist.github.com/alexreardon/10c595cbb840608a2828db56df99fa79
                    setDragEnterState(dragState => {
                        if (!dragState) return dragState;
                        if (dragState.count <= 1) return null;
                        return {...dragState, count: dragState.count - 1};
                    });
                }}
                onDragOver={event => {
                    event.preventDefault();
                }}
                onDrop={event => {
                    event.preventDefault();
                    setDragEnterState(null);

                    if (!isDraggingFileWithin && dragEnterState?.hasNonTextType) {
                        drop(event.dataTransfer);
                    }
                }}
            >
                <Box position="relative">
                    <Box
                        className={pointerEventsNoneNotInheritedClassName}
                        position="absolute"
                        left="0"
                        bottom="0"
                        zIndex="20"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={{
                            width: messageInputEditorMinHeightPx[platform][spacingScale],
                            height: messageInputEditorMinHeightPx[platform][spacingScale],
                        }}
                    >
                        <MenuButton
                            withoutButtonElementRequirement={true}
                            // Generally since the message input is at the bottom of the screen the add
                            // menu opens above the input. Let's make that pattern consistent.
                            placement="top-start"
                            actions={[
                                {
                                    label: "Image",
                                    icon: <Image />,
                                    onPress: () => {
                                        selectFiles(assertExists(containerRef.current), {
                                            multiple: true,
                                            acceptContentTypes: getFileImageContentTypes(),
                                            // It's important to return focus before removing the temporary input element
                                            // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                            // finished.
                                            onReturnFocus: () => editorRef.current?.focus(),
                                        })
                                            .then(files => {
                                                if (files.length === 0) return;

                                                // Make sure we didn't unmount while selecting files.
                                                if (!isMounted()) return;

                                                addFiles(
                                                    "<ContentEditorCommentInputFloater> insert files",
                                                    files.map(file => ({
                                                        type: "UploadFile",
                                                        input: {type: "File", file},
                                                    })),
                                                );
                                            })
                                            .catch(scheduleUncaughtError);
                                    },
                                },
                                {
                                    label: "Video",
                                    icon: <VideoIcon />,
                                    onPress: () => {
                                        selectFiles(assertExists(containerRef.current), {
                                            multiple: true,
                                            acceptContentTypes: getFileVideoContentTypes(),
                                            // It's important to return focus before removing the temporary input element
                                            // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                            // finished.
                                            onReturnFocus: () => editorRef.current?.focus(),
                                        })
                                            .then(files => {
                                                if (files.length === 0) return;

                                                // Make sure we didn't unmount while selecting files.
                                                if (!isMounted()) return;

                                                addFiles(
                                                    "<ContentEditorCommentInputFloater> insert files",
                                                    files.map(file => ({
                                                        type: "UploadFile",
                                                        input: {type: "File", file},
                                                    })),
                                                );
                                            })
                                            .catch(scheduleUncaughtError);
                                    },
                                },
                                {
                                    label: "Audio",
                                    icon: <WaveformIcon />,
                                    onPress: () => {
                                        selectFiles(assertExists(containerRef.current), {
                                            multiple: true,
                                            acceptContentTypes: getFileAudioContentTypes(),
                                            // It's important to return focus before removing the temporary input element
                                            // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                            // finished.
                                            onReturnFocus: () => editorRef.current?.focus(),
                                        })
                                            .then(files => {
                                                if (files.length === 0) return;

                                                // Make sure we didn't unmount while selecting files.
                                                if (!isMounted()) return;

                                                addFiles(
                                                    "<ContentEditorCommentInputFloater> insert files",
                                                    files.map(file => ({
                                                        type: "UploadFile",
                                                        input: {type: "File", file},
                                                    })),
                                                );
                                            })
                                            .catch(scheduleUncaughtError);
                                    },
                                },
                                {
                                    label: "File",
                                    icon: <File />,
                                    onPress: () => {
                                        selectFiles(assertExists(containerRef.current), {
                                            multiple: true,
                                            // It's important to return focus before removing the temporary input element
                                            // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                            // finished.
                                            onReturnFocus: () => editorRef.current?.focus(),
                                        })
                                            .then(files => {
                                                if (files.length === 0) return;

                                                // Make sure we didn't unmount while selecting files.
                                                if (!isMounted()) return;

                                                addFiles(
                                                    "<ContentEditorCommentInputFloater> insert files",
                                                    files.map(file => ({
                                                        type: "UploadFile",
                                                        input: {type: "File", file},
                                                    })),
                                                );
                                            })
                                            .catch(scheduleUncaughtError);
                                    },
                                },
                            ]}
                        >
                            <IconButton
                                size={messageInputEditorIconButtonSize}
                                description="Add"
                                withoutTooltip={true}
                                // The add icon button is not focusable. That's because we don't want to
                                // remove focus from the message input when the add button is pressed. That
                                // way on mobile you can keep typing and sending messages because the software
                                // keyboard doesn't disappear.
                                //
                                // On desktop, hitting enter in the message input is sufficient for keyboard
                                // control of the message input.
                                isFocusable={false}
                            >
                                <Plus />
                            </IconButton>
                        </MenuButton>
                    </Box>
                    <FocusRing
                        offset="border"
                        isVisible={!isDraggingFileWithin && dragEnterState?.hasNonTextType}
                        isVisibleWhenFocusWithin={true}
                    >
                        <Box
                            ref={useScrollbar({
                                insetTop: messageInputEditorBorderRadiusPx[platform][spacingScale],
                                // Don't overlap the send button which is rendered at the bottom of
                                // the input.
                                insetBottom: messageInputEditorMinHeightPx[platform][spacingScale],
                            })}
                            maxHeight="96"
                            position="relative"
                            overflowX="hidden"
                            overflowY="auto"
                            style={{
                                minHeight: messageInputEditorMinHeightPx[platform][spacingScale],
                                // This border radius is used by the `<FocusRing>` when the
                                // `<FocusRing>` is visible.
                                borderTopLeftRadius:
                                    messageInputEditorBorderRadiusPx[platform][spacingScale],
                                borderTopRightRadius:
                                    messageInputEditorBorderRadiusPx[platform][spacingScale],
                                borderBottomLeftRadius:
                                    files.length === 0
                                        ? messageInputEditorBorderRadiusPx[platform][spacingScale]
                                        : undefined,
                                borderBottomRightRadius:
                                    files.length === 0
                                        ? messageInputEditorBorderRadiusPx[platform][spacingScale]
                                        : undefined,
                            }}
                            // Turn off pointer events when we've dragged a file over this input. Otherwise
                            // the file is uploaded twice! Since we upload once for the `onDrop` handler on
                            // our parent element and again for the `onDrop` handler on the
                            // `<ContentEditor>`.
                            pointerEvents={
                                !isDraggingFileWithin && dragEnterState?.hasNonTextType
                                    ? "none"
                                    : undefined
                            }
                        >
                            <ContentBlockWidthContextProvider
                                width="96"
                                paddingX={addRemLengths(
                                    screenPaddingX[platform],
                                    messageViewMarginLeft,
                                )}
                            >
                                <ContentEditor
                                    ref={editorRef}
                                    state={commentState}
                                    onChange={setCommentState}
                                    aria-label="New comment"
                                    placeholder="Add a comment"
                                    style={{
                                        paddingLeft: messageInputEditorPaddingX[platform],
                                        paddingRight: messageInputEditorPaddingX[platform],
                                        paddingTop:
                                            messageInputEditorPaddingYPx[platform][spacingScale],
                                        paddingBottom:
                                            messageInputEditorPaddingYPx[platform][spacingScale],
                                    }}
                                    onEnterKeyDownFromPhysicalKeyboard={event => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        assertExists(sendButtonRef.current).press();
                                    }}
                                    onPasteOrDropFiles={fileInfos =>
                                        addFiles(
                                            "<ContentEditorCommentInputFloater> paste files",
                                            fileInfos,
                                        )
                                    }
                                    // Don't render the default content editor mobile keyboard toolbar. We render
                                    // our own `<MessageInputMobileKeyboardToolbar>` outside of the content editor.
                                    withoutMobileKeyboardToolbar={true}
                                    // Message input is always editable, never interactive on mobile. So you can't
                                    // click links among other things.
                                    withoutMobileDualModality={true}
                                />
                            </ContentBlockWidthContextProvider>
                        </Box>
                    </FocusRing>
                    <Box
                        className={pointerEventsNoneNotInheritedClassName}
                        position="absolute"
                        right="0"
                        bottom="0"
                        zIndex="20"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={{
                            height: messageInputEditorMinHeightPx[platform][spacingScale],
                            width: messageInputEditorMinHeightPx[platform][spacingScale],
                        }}
                    >
                        <IconButton
                            ref={sendButtonRef}
                            size={messageInputEditorIconButtonSize}
                            variant="accent"
                            description="Save comment"
                            pressErrorTitle="Can&#x2019;t save comment"
                            onPress={sendComment}
                            isDisabled={isSendButtonDisabled}
                            // The send icon button is not focusable. That's because we don't want to
                            // remove focus from the message input when the send button is pressed. That
                            // way on mobile you can keep typing and sending messages because the software
                            // keyboard doesn't disappear.
                            //
                            // On desktop, hitting enter in the message input is sufficient for keyboard
                            // control of the message input.
                            isFocusable={false}
                        >
                            <ArrowRight
                                size={spacing["4"]}
                                weight={!isSendButtonDisabled ? "bold" : undefined}
                            />
                        </IconButton>
                    </Box>
                </Box>
                {files.length > 0 && (
                    <Box
                        pointerEvents="none"
                        position="relative"
                        paddingTop="4"
                        paddingBottom="4"
                        style={{
                            paddingLeft: subtractRemLengths(
                                "4",
                                messageInputFilesOverflowGradientWidth,
                            ),
                            paddingRight: subtractRemLengths(
                                "4",
                                messageInputFilesOverflowGradientWidth,
                            ),
                        }}
                    >
                        <Box
                            position="absolute"
                            zIndex="10"
                            top="0"
                            left="0"
                            right="0"
                            height="border"
                            backgroundColor="grey-5"
                        />
                        <Box
                            pointerEvents="auto"
                            position="relative"
                            zIndex="0"
                            width="full"
                            marginTop="-2"
                        >
                            <Box
                                position="absolute"
                                zIndex="10"
                                top="0"
                                bottom="0"
                                left="0"
                                width={messageInputFilesOverflowGradientWidth}
                                style={{
                                    background: `linear-gradient(to right, ${backgroundColorVar}, transparent)`,
                                }}
                            />
                            <Box
                                position="absolute"
                                zIndex="10"
                                top="0"
                                bottom="0"
                                right="0"
                                width={messageInputFilesOverflowGradientWidth}
                                style={{
                                    background: `linear-gradient(to left, ${backgroundColorVar}, transparent)`,
                                }}
                            />
                            <Box
                                data-scrollbar="false"
                                position="relative"
                                zIndex="0"
                                width="full"
                                overflowX="auto"
                            >
                                <Box
                                    display="flex"
                                    gap="2"
                                    paddingTop="2"
                                    paddingX={messageInputFilesOverflowGradientWidth}
                                    style={{width: "fit-content"}}
                                >
                                    {files.map(file =>
                                        file.type === "FileEntity" ? (
                                            <MessageInputFileEntityPreview
                                                key={file.key}
                                                fileEntityId={file.fileEntityId}
                                                fileEntityResult={file.fileEntityResult}
                                                onRemove={() => {
                                                    setFiles(files =>
                                                        files.filter(
                                                            otherFile => otherFile.key !== file.key,
                                                        ),
                                                    );
                                                }}
                                            />
                                        ) : (
                                            <MessageInputFilePreview
                                                key={file.key}
                                                signedUrlSearch={file.signedUrlSearch}
                                                file={file.file}
                                                attachmentTarget={file.attachmentTarget}
                                                onRemove={() => {
                                                    setFiles(files =>
                                                        files.filter(
                                                            otherFile => otherFile.key !== file.key,
                                                        ),
                                                    );
                                                }}
                                            />
                                        ),
                                    )}
                                </Box>
                            </Box>
                        </Box>
                    </Box>
                )}
            </Box>
            {shouldShowConfirmCloseDialog && (
                <ModalDialog
                    title="Save comment"
                    description="Would you like to save your comment?"
                    onClose={() => {
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel"
                        // and lets the user continue writing.
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmCloseDialog(false);
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle="Can&#x2019;t save comment"
                    onPrimaryButtonPress={sendComment}
                    cancelButtonLabel="Discard comment"
                    onCancelButtonPress={onCloseWithoutAnimation}
                />
            )}
        </>
    );
}
