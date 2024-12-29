import {ArrowRight, File, Image, Plus} from "phosphor-react";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {Memo, RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {
    ContentEditorState,
    createCommentThreadMetaKey,
    updateContentEditorReferences,
} from "~/client/content/content_editor_state.js";
import {ContentEditorCursorTracker} from "~/client/content/internal/content_editor_cursor_tracker.js";
import {FileInfo} from "~/client/content/internal/iterate_file_infos_in_element.js";
import {
    MessageInputFile,
    addMessageInputFiles,
} from "~/client/content/messaging/add_message_input_files.js";
import {MessageInputFilePreview} from "~/client/content/messaging/message_input_file_preview.js";
import {selectFiles} from "~/client/content/select_files.js";
import {trimContentEnd, trimContentWithReferencesEnd} from "~/client/content/trim_content.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayRef} from "~/client/design/overlay.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {useReporter} from "~/client/design/reporter.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {VideoIcon} from "~/client/icons/video_icon.js";
import {WaveformIcon} from "~/client/icons/waveform_icon.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useAddGlobalLoadingIndicator} from "~/client/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    messageInputEditorBorderRadiusPx,
    messageInputEditorIconButtonSize,
    messageInputEditorMinHeightPx,
    messageInputEditorPaddingX,
    messageInputEditorPaddingYPx,
    messageInputFilesOverflowGradientWidth,
} from "~/client/styles/messaging_shared_styles.js";
import {
    backgroundColorVar,
    greyElevated2ClassName,
    overlayFadeOutAnimationDurationMs,
    pointerEventsNoneNotInheritedClassName,
} from "~/client/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {spacing, subtractRemLengths} from "~/shared/design/core/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {
    getFileAudioContentTypes,
    getFileImageContentTypes,
    getFileVideoContentTypes,
} from "~/shared/files/file_content_type.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

export function ContentEditorCommentInputFloater({
    state,
    viewRef,
    range,
    fileAttachmentTarget,
    onClose: _onCloseWithoutAnimation,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    onClose: () => void;
}) {
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

        _onCloseWithoutAnimation();
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

    return (
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
                <Box>
                    <ContentEditorCommentInput
                        state={state}
                        viewRef={viewRef}
                        isNodeRange={isNodeRange}
                        range={range}
                        fileAttachmentTarget={fileAttachmentTarget}
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
    );
}

function ContentEditorCommentInput({
    state: documentState,
    viewRef: documentViewRef,
    isNodeRange: isNodeDocumentRange,
    range: documentRange,
    fileAttachmentTarget,
    onCloseWithoutAnimation,
    onCloseWithAnimation,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    isNodeRange: boolean;
    range: {from: number; to: number};
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    onCloseWithoutAnimation: () => void;
    onCloseWithAnimation: () => void;
}) {
    const context = useAppContext();
    const reporter = useReporter();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const {currentAccount, space} = useSpaceContext();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    const [commentState, setCommentState] = useState(() =>
        ContentEditorState.create(emptyMessageContentWithReferences),
    );
    const [files, setFiles] = useState<ReadonlyArray<MessageInputFile>>(emptyArray);
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

        transaction.setMeta(createCommentThreadMetaKey, {
            commentThreadId,
            initialCommentContent: content,
            initialCommentFileIds: files.map(({file}) => file.id),
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

    const addFiles = (
        spanName: string,
        fileInfos: ReadonlyArray<FileInfo>,
    ): {finally(listener: () => void): void} => {
        if (fileInfos.length === 0) return Promise.resolve();

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
            reporter.displayError("Couldn’t upload file", error);
        });

        return promise;
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
                                    iconSize: "4",
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
                                    iconSize: "4",
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
                                    iconSize: "4",
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
                                    iconSize: "4",
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
                    <FocusRing offset="border" isVisibleWhenFocusWithin={true}>
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
                                onEnterFromPhysicalKeyboard={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    assertExists(sendButtonRef.current).press();
                                }}
                                onPasteOrDropFiles={fileInfos => {
                                    addFiles(
                                        "<ContentEditorCommentInputFloater> paste files",
                                        fileInfos,
                                    );
                                }}
                                // Don't render the default content editor mobile keyboard toolbar. We render
                                // our own `<MessageInputMobileKeyboardToolbar>` outside of the content editor.
                                withoutMobileKeyboardToolbar={true}
                                // Message input is always editable, never interactive on mobile. So you can't
                                // click links among other things.
                                withoutMobileDualModality={true}
                            />
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
                            pressErrorTitle="Can’t save comment"
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
                                    {files.map(file => (
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
                                    ))}
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
                    primaryButtonPressErrorTitle="Can’t save comment"
                    onPrimaryButtonPress={sendComment}
                    cancelButtonLabel="Discard comment"
                    onCancelButtonPress={onCloseWithoutAnimation}
                />
            )}
        </>
    );
}
