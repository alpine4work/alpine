import classNames from "classnames";
import {Schema as ProsemirrorSchema} from "prosemirror-model";
import {useMemo, useRef, useState} from "react";
import {useContentFilePreviewExpirationTimers} from "~/client/content/internal/content_file_preview_expiration_timers.js";
import {
    addContentFilePreviewBehavior,
    renderContentFilePreview,
} from "~/client/content/internal/render_content_file_preview.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useReporter} from "~/client/design/reporter.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/use_store.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useNavigate, useRootNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {contentBaseProsemirrorSchemaSpec} from "~/shared/content/content_schema.js";
import {createContentFileProsemirrorNodeSpecs} from "~/shared/content/content_schema_extra.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {screenPaddingXRem} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {HtmlGenerator} from "~/shared/helpers/html/html_generator.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {computeStore} from "~/shared/store/compute_store.js";

// Create a temporary schema we can use for constructing a `file` node we
// can copy.
const prosemirrorSchema = new Lazy(
    () =>
        new ProsemirrorSchema({
            nodes: {
                ...contentBaseProsemirrorSchemaSpec.nodes,
                ...createContentFileProsemirrorNodeSpecs(),
            },
            marks: contentBaseProsemirrorSchemaSpec.marks,
        }),
);

export function ChannelViewFilePreview({
    postId,
    file: initialFile,
    signedUrlSearch: initialSignedUrlSearch,
    size,
}: {
    postId: PostId;
    file: FileModel;
    signedUrlSearch: string;
    size: number;
}) {
    const context = useAppContext();
    const reporter = useReporter();
    const isInitialAppRender = useIsInitialAppRender();
    const rootNavigate = useRootNavigate();
    const navigate = useNavigate();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const {space} = useSpaceContext();

    const containerRef = useRef<HTMLDivElement>(null);

    const [file, setFile] = useState(initialFile);
    const [signedUrlSearch, setSignedUrlSearch] = useState(initialSignedUrlSearch);

    const expirationTimers = useContentFilePreviewExpirationTimers();

    const htmlGenerator = useStore(
        useMemo(() => {
            return computeStore(get => {
                const html = renderContentFilePreview(get, {
                    spaceId: space.id,
                    node: prosemirrorSchema.get().node("file", {fileId: file.id}),
                    reference: {signedUrlSearch, file},
                    layout: {width: size, widthFr: 1, height: size},
                    // `screenWidth` is used to scale down code file previews. Code previews at
                    // 100% of this width (minus `screenPaddingX * 2`) are rendered with a font
                    // size of 75. Set a `screenWidth` that'll scale the code preview down to a
                    // font size of 25.
                    screenWidth:
                        size *
                            (fontSizesBySpacingScale["75"].medium.fontSize /
                                fontSizesBySpacingScale["25"].medium.fontSize) +
                        screenPaddingXRem[platform] * remPxBySpacingScale[spacingScale] * 2,
                    platform,
                    spacingScale,
                    isInitialAppRender,
                    expirationTimers,
                    // Disable video and audio file interactivity. When pressed we should always
                    // open the post in a peek.
                    withoutInteractivity: true,
                });

                html.setAttribute(
                    "class",
                    classNames(
                        html.getAttribute("class"),
                        contentStyles.fileChannelViewPreviewClassName,
                    ),
                );

                return html;
            });
        }, [
            expirationTimers,
            file,
            isInitialAppRender,
            platform,
            signedUrlSearch,
            size,
            space.id,
            spacingScale,
        ]),
    );

    const previousHtmlGeneratorRef = useRef<HtmlGenerator | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        const containerElement = assertExists(containerRef.current);

        const previousHtmlGenerator = previousHtmlGeneratorRef.current;
        previousHtmlGeneratorRef.current = htmlGenerator;

        if (previousHtmlGenerator === htmlGenerator) return;

        if (!previousHtmlGenerator) {
            // This case happens during a hot reload. We need to remove the children
            // currently in the DOM.
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
                node: prosemirrorSchema.get().node("file", {fileId: file.id}),
                reference: {signedUrlSearch, file},
                attachmentTarget: {type: "Post", postId},
                expirationTimers,
                isInitialAppRender,
                rootNavigate,
                getReporter: () => reporter,
                onUpdate: (file, signedUrlSearch) => {
                    setFile(file);
                    setSignedUrlSearch(signedUrlSearch);
                },
                onSignedUrlRefresh: signedUrlSearch => {
                    setSignedUrlSearch(signedUrlSearch);
                },
                onOpenViewer: () => {
                    navigate(`/s/${space.id}/posts/${postId}?scroll=file-${file.id}`);

                    return {preventDefault: true};
                },
            },
        );

        return () => {
            cleanup();
        };
    }, [
        context,
        expirationTimers,
        file,
        isInitialAppRender,
        navigate,
        postId,
        reporter,
        rootNavigate,
        signedUrlSearch,
        space.id,
    ]);

    return (
        <Box
            ref={containerRef}
            width="full"
            height="full"
            style={{display: "grid", gridTemplateRows: "1fr", gridTemplateColumns: "1fr"}}
            dangerouslySetInnerHTML={
                isInitialAppRender ? {__html: htmlGenerator.generateHtml()} : undefined
            }
        />
    );
}
