import classNames from "classnames";
import {Memo, useMemo, useRef} from "react";
import {useFileRegistry} from "~/client/web/content/file_registry_context.js";
import {ContentBaseProsemirrorSchemaWithFiles} from "~/client/web/content/internal/content_base_schema_with_files.js";
import {
    addContentFilePreviewBehavior,
    renderContentFilePreview,
} from "~/client/web/content/internal/content_file_preview.js";
import {useMediaDebugModeEnabled} from "~/client/web/content/media_debug_mode.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate, useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {HtmlGenerator} from "~/shared/helpers/html/html_generator.js";

export function ContentFilePreview({
    size,
    signedUrlSearch,
    file: fileFromProps,
    attachmentTarget,
    onOpenViewer,
}: {
    size: number;
    signedUrlSearch: string;
    file: FileModel;
    attachmentTarget: Memo<FileAttachmentTarget> | "Uploader";
    onOpenViewer?: Memo<() => {preventDefault: boolean} | void>;
}) {
    const context = useAppContext();
    const reporter = useReporter();
    const isInitialAppRender = useIsInitialAppRender();
    const rootNavigate = useRootNavigate();
    const navigate = useNavigate();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const {space} = useSpaceContext();
    const fileRegistry = useFileRegistry();
    const isMediaDebugModeEnabled = useMediaDebugModeEnabled();

    const containerRef = useRef<HTMLDivElement>(null);

    const file = useStore(
        useMemo(
            () => fileRegistry.getFileStore({signedUrlSearch, file: fileFromProps}),
            [fileFromProps, fileRegistry, signedUrlSearch],
        ),
    );

    const node = useMemo(
        () => ContentBaseProsemirrorSchemaWithFiles.get().node("file", {fileId: file.id}),
        [file.id],
    );

    const htmlGenerator = useMemo(() => {
        const html = renderContentFilePreview({
            spaceId: space.id,
            node,
            file,
            layout: {width: size, widthFr: 1, height: size},
            // Code previews use `blockWidth` to scale down text. Set a `blockWidth` that'll
            // scale the code preview down to a font size of 25.
            blockWidth:
                size *
                (fontSizesBySpacingScale["75"].small.fontSize /
                    fontSizesBySpacingScale["25"].small.fontSize),
            transformScale: 1,
            platform,
            spacingScale,
            isInitialAppRender,
            // Disable video and audio file interactivity. When pressed we should always open
            // the post in a peek.
            withoutInteractivity: true,
            isMediaDebugModeEnabled,
        });

        html.setAttribute(
            "class",
            classNames(
                html.getAttribute("class"),
                contentStyles.alwaysShowFileBorderClassName,
                contentStyles.withoutFileSelectionClassName,
            ),
        );

        return html;
    }, [
        file,
        isInitialAppRender,
        isMediaDebugModeEnabled,
        node,
        platform,
        size,
        space.id,
        spacingScale,
    ]);

    const previousHtmlGeneratorRef = useRef<HtmlGenerator | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        const containerElement = assertExists(containerRef.current);

        const previousHtmlGenerator = previousHtmlGeneratorRef.current;
        previousHtmlGeneratorRef.current = htmlGenerator;

        if (previousHtmlGenerator === htmlGenerator) return;

        if (!previousHtmlGenerator) {
            // This case happens during a hot reload. We need to remove the children currently
            // in the DOM.
            while (containerElement.hasChildNodes()) {
                containerElement.firstChild!.remove();
            }

            containerElement.appendChild(htmlGenerator.generateNode());
        } else {
            assert(
                htmlGenerator.patchNode(
                    previousHtmlGenerator,
                    assertExists(containerElement.firstElementChild),
                ),
            );
        }
    }, [htmlGenerator, isInitialAppRender]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        const containerElement = assertExists(containerRef.current);

        const cleanup = addContentFilePreviewBehavior(
            () => context,
            assertExists(containerElement.firstElementChild) as HTMLElement,
            {
                spaceId: space.id,
                file,
                attachmentTarget,
                rootNavigate,
                getReporter: () => reporter,
                onOpenViewer,
            },
        );

        return () => {
            cleanup();
        };
    }, [
        attachmentTarget,
        context,
        file,
        isInitialAppRender,
        navigate,
        node,
        onOpenViewer,
        reporter,
        rootNavigate,
        signedUrlSearch,
        space.id,
    ]);

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
                display: "grid",
                gridTemplateRows: "1fr",
                gridTemplateColumns: "1fr",
            }}
            dangerouslySetInnerHTML={
                isInitialAppRender ? {__html: htmlGenerator.generateHtml()} : undefined
            }
        />
    );
}
