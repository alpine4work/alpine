import {Memo, useCallback, useMemo, useRef} from "react";
import {BlobsArt} from "~/client/web/blobs/blobs_art.js";
import {ContentView} from "~/client/web/content/content_view.js";
import {createContentChangesetDecorations} from "~/client/web/content/create_content_changeset_decorations.js";
import {Box} from "~/client/web/design/box.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {DocumentHistorySelection} from "~/client/web/documents/document_history_selection.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {getPlatformRouteLayout, useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {contentStyles, documentContentStyles} from "~/client/web/styles/styles.js";
import {titleClassName} from "~/shared/design/core/constant_class_names.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {assertDocumentContent} from "~/shared/documents/document_content_schema.js";
import {getDocumentContentTitle} from "~/shared/documents/document_model.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

export function DocumentHistoryDiffView({
    documentId,
    selection,
    fileAttachmentTarget,
}: {
    documentId: DocumentId;
    selection: DocumentHistorySelection;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
}) {
    const renderedDiff = useMemo(
        () =>
            createContentChangesetDecorations({
                startDoc: selection.diff.startContent,
                steps: selection.diff.steps,
            }),
        [selection.diff],
    );
    const endContent = useMemo(
        () => assertDocumentContent(renderedDiff.endDoc),
        [renderedDiff.endDoc],
    );
    const content = useMemo(
        () => ({doc: renderedDiff.renderedDoc, references: selection.diff.contentReferences}),
        [renderedDiff.renderedDoc, selection.diff.contentReferences],
    );
    const blobsSettings = useMemo(() => {
        const cover = endContent.attrs.cover;
        return cover?.type === "Blobs"
            ? {
                  seed: cover.seed,
                  themeColor: cover.themeColor,
                  hueSpread: cover.hueSpread,
              }
            : null;
    }, [endContent.attrs.cover]);
    const coverArt = blobsSettings !== null ? <BlobsArt settings={blobsSettings} /> : null;
    const scrollViewRef = useRef<HTMLDivElement>(null);
    const bottomScrollSpaceRef = useRef<HTMLDivElement>(null);
    const documentContentRef = useRef<HTMLDivElement>(null);
    const [scrollViewResizeRef, scrollViewSize] = useResizeObserver();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const navigationBar = useNavigationBar({
        title: getDocumentContentTitle(endContent),
        defaultPreviousRoute: `/doc/${documentId}`,
        getTitleBoundaryElement: useCallback(
            () =>
                assertExists(
                    documentContentRef.current?.querySelector<HTMLElement>(`.${titleClassName}`),
                ),
            [],
        ),
        titleBoundaryMarginTop: useMemo(
            () =>
                addRemLengths(
                    contentStyles.titlePaddingTop[getPlatformRouteLayout(platform, routeLayout)],
                    "4",
                ),
            [platform, routeLayout],
        ),
        desktopTitleMaxWidth: contentStyles.contentMaxWidth,
        desktopTitleFontSize: "400",
        desktopTitleFontWeight: "bold",
        contentCover: blobsSettings !== null ? <BlobsArt settings={blobsSettings} /> : undefined,
    });

    useLayoutEffectWithoutServerSideWarning(() => {
        const scrollView = scrollViewRef.current;
        const bottomScrollSpace = bottomScrollSpaceRef.current;
        if (!scrollView || !bottomScrollSpace) return;
        bottomScrollSpace.style.height = "0px";

        if (renderedDiff.hasOnlyCoverChanges) {
            scrollView.scrollTop = 0;
            return;
        }

        const firstChange = scrollView.querySelector<HTMLElement>("ins, del");
        if (!firstChange) return;

        const scrollViewRect = scrollView.getBoundingClientRect();
        const firstChangeRect = firstChange.getBoundingClientRect();
        const firstChangeTop = firstChangeRect.top - scrollViewRect.top + scrollView.scrollTop;
        const firstChangeViewportTop = (scrollView.clientHeight - firstChangeRect.height) / 2;

        const contentView = firstChange.closest<HTMLElement>(
            '[aria-label^="Document at version "]',
        );
        if (!contentView) return;

        const trailingContentHeight =
            contentView.getBoundingClientRect().bottom - firstChangeRect.bottom;
        bottomScrollSpace.style.height = `${Math.max(
            0,
            scrollView.clientHeight -
                firstChangeViewportTop -
                firstChangeRect.height -
                trailingContentHeight,
        )}px`;
        scrollView.scrollTop = Math.max(0, firstChangeTop - firstChangeViewportTop);
    }, [renderedDiff, scrollViewSize]);

    return (
        <Box
            ref={useMergedRefs(
                useScrollbar({insetTop: navigationBar.scrollbarInsetTop}),
                scrollViewRef,
                scrollViewResizeRef,
                navigationBar.scrollViewRef,
            )}
            height="full"
            width="full"
            position="relative"
            // Tables and code blocks manage their own horizontal overflow. Keep the cover
            // art's oversized canvas from turning the history pane itself into a horizontal
            // scroller.
            overflowX="hidden"
            overflowY="auto"
        >
            <Box minHeight="full" width="full" position="relative" zIndex="0">
                {coverArt}
                <Box ref={documentContentRef}>
                    <ContentView
                        content={content}
                        className={documentContentStyles.contentClassName}
                        decorations={renderedDiff.decorations}
                        fileAttachmentTarget={fileAttachmentTarget}
                        aria-label={`Document at version ${selection.range.endVersion}`}
                    />
                </Box>
                <Box ref={bottomScrollSpaceRef} width="full" style={{height: 0}} />
                {navigationBar.navigationBar}
            </Box>
        </Box>
    );
}
