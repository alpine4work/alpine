import {
    Memo,
    Ref,
    RefObject,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {
    DocumentPresentationSlide,
    getDocumentPresentationSlides,
} from "~/client/documents/internal/document_presentation_slide.js";
import {DocumentPresentationView} from "~/client/documents/internal/document_presentation_view.js";
import {GlobalKeyDownEventModal} from "~/client/helpers/global_key_down_event.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {getPlatformWithoutListening} from "~/client/remix/platform_context.js";
import {getPlatformRouteLayout, useRouteLayout} from "~/client/remix/route_layout_context.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {
    DocumentContentReferences,
    DocumentContentWithReferences,
} from "~/shared/documents/document_content_references.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

export type DocumentPresentationControllerRef = {
    present(): Promise<void>;
};

const DocumentPresentationControllerForwardRef = forwardRef(DocumentPresentationController);
export {DocumentPresentationControllerForwardRef as DocumentPresentationController};

function DocumentPresentationController(
    {
        editorRef,
        editorContainerRef,
        editorState,
        fileAttachmentTarget,
    }: {
        editorRef: RefObject<ContentEditorRef<DocumentContentWithReferences>>;
        editorContainerRef: RefObject<HTMLDivElement>;
        editorState: ContentEditorState<DocumentContentWithReferences>;
        fileAttachmentTarget: Memo<FileAttachmentTarget>;
    },
    ref: Ref<DocumentPresentationControllerRef>,
) {
    const routeLayout = useRouteLayout();

    const fullscreenRef = useRef<HTMLDivElement>(null);

    const [presentationState, setPresentationState] = useState<{
        readonly slides: ReadonlyArray<DocumentPresentationSlide>;
        readonly references: DocumentContentReferences;
        readonly initialSlideIndex: number;
    } | null>(null);

    const present = useEvent(async () => {
        if (presentationState) return;

        const platform = getPlatformWithoutListening();
        const spacingScale = getSpacingScaleWithoutListening();

        const editor = assertExists(editorRef.current);
        const editorContainerElement = assertExists(editorContainerRef.current);

        // Freeze content when the presentation opens. The presentation won't
        // update in realtime to avoid confusion while presenting.
        const content = editorState.getContent();

        const slides = getDocumentPresentationSlides(content.doc);

        const editorTop =
            editorContainerElement.getBoundingClientRect().top +
            convertRemLengthToPx(navigationBarHeight, spacingScale);

        // Find the first visible slide in the document. We'll use this as the initial
        // slide index.
        let slideIndex = 0;
        for (; slideIndex < slides.length; slideIndex++) {
            const slide = slides[slideIndex]!;

            const slideTop =
                editor.coordsAtPos(slide.pos).top +
                (slideIndex === 0
                    ? convertRemLengthToPx(
                          contentStyles.titlePaddingTop[
                              getPlatformRouteLayout(platform, routeLayout)
                          ],
                          spacingScale,
                      )
                    : 0);

            if (slideTop >= editorTop) {
                break;
            }
        }

        // Render the presentation view synchronously. Since Chrome only allows
        // `requestFullscreen()` to work in response to a direct user interaction (in
        // our case, the user clicking on a menu item).
        //
        // We need to render presentation mode synchronously so that Chrome correctly
        // associates our `requestFullscreen()` call with the user's click interaction.
        // Previously we awaited a promise that was resolved in a `useEffect()` which
        // sometimes caused Chrome to consider the `requestFullscreen()` call invalid.
        flushSync(() => {
            setPresentationState({
                slides,
                references: content.references,
                initialSlideIndex: clamp(0, slideIndex, slides.length),
            });
        });

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
                        slides={presentationState.slides}
                        references={presentationState.references}
                        initialSlideIndex={presentationState.initialSlideIndex}
                        fileAttachmentTarget={fileAttachmentTarget}
                    />
                </GlobalKeyDownEventModal>
            </Box>
        </Box>
    );
}
