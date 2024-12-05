import {Memo, Ref, forwardRef, useEffect, useImperativeHandle, useRef, useState} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {DocumentPresentationView} from "~/client/documents/internal/document_presentation_view.js";
import {GlobalKeyDownEventModal} from "~/client/helpers/global_key_down_event.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export type DocumentPresentationControllerRef = {
    present(): Promise<void>;
};

const DocumentPresentationControllerForwardRef = forwardRef(DocumentPresentationController);
export {DocumentPresentationControllerForwardRef as DocumentPresentationController};

function DocumentPresentationController(
    {
        editorState,
        fileAttachmentTarget,
    }: {
        editorState: ContentEditorState<DocumentContentWithReferences>;
        fileAttachmentTarget: Memo<FileAttachmentTarget>;
    },
    ref: Ref<DocumentPresentationControllerRef>,
) {
    const fullscreenRef = useRef<HTMLDivElement>(null);

    const [presentationState, setPresentationState] = useState<{
        renderPromiseResolver: PromiseResolver<void>;
    } | null>(null);

    const present = useEvent(async (): Promise<void> => {
        if (presentationState) return;

        const renderPromiseResolver = createPromiseResolver();
        setPresentationState({renderPromiseResolver});

        await renderPromiseResolver.promise;

        const fullscreenElement = assertExists(fullscreenRef.current);

        try {
            await fullscreenElement.requestFullscreen({navigationUI: "hide"});
        } catch (error) {
            setPresentationState(null);
            throw error;
        }
    });

    useImperativeHandle(ref, () => ({present}), [present]);

    useEffect(() => {
        if (!presentationState) return;

        const fullscreenElement = assertExists(fullscreenRef.current);

        presentationState.renderPromiseResolver.resolve();

        const handleFullscreenChange = () => {
            if (document.fullscreenElement !== fullscreenElement) {
                setPresentationState(null);
            }
        };

        fullscreenElement.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => {
            fullscreenElement.removeEventListener("fullscreenchange", handleFullscreenChange);
        };
    }, [presentationState]);

    if (!presentationState) return null;

    return (
        <Box position="fixed" top="0" width="0" height="0" overflow="hidden">
            <Box
                ref={fullscreenRef}
                overflow="hidden"
                backgroundColor="grey-0"
                style={{width: "100vw", height: "100vh"}}
            >
                <GlobalKeyDownEventModal>
                    <DocumentPresentationView
                        initialContent={editorState.getContent()}
                        fileAttachmentTarget={fileAttachmentTarget}
                    />
                </GlobalKeyDownEventModal>
            </Box>
        </Box>
    );
}
