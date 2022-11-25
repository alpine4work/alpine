import {ArrowClockwise} from "phosphor-react";
import {useId, useRef, useState} from "react";
import {
    DocumentBlobFactory,
    DocumentBlobFactorySettings,
    useDocumentBlobSettings,
} from "~/client/blob_factory/document_blobs";
import {ContentEditor} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {Box} from "~/client/design/box";
import {ColorSchemeToggleButton} from "~/client/design/color_scheme_toggle_button";
import {IconButton} from "~/client/design/icon_button";
import {TextInput} from "~/client/design/text_input";
import {useConstant} from "~/client/helpers/lifecycle/use_constant";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {themeColors} from "~/shared/design/theme_colors";
import {dummyDocumentContent} from "~/shared/documents/dummy_document_content";
import {noop} from "~/shared/helpers/control/noop";
import {generateId} from "~/shared/id/id";
import {sprinkles} from "~/shared/styles/styles";

export function DocumentBlobsPlayground() {
    const [seed, setSeed] = useState<string>(generateId());
    const settings = {
        ...useDocumentBlobSettings({defaultSeed: seed}),
        seed,
    };

    return (
        <Box padding="6" display="flex" flexDirection="column" gap="6">
            <Box
                display="flex"
                flexDirection="row"
                alignItems="center"
                justifyContent="space-between"
                position="sticky"
                top="6"
                zIndex="10"
            >
                <Box display="flex" flexDirection="row" style={{flexBasis: 400}} gap="4">
                    <TextInput label="Seed" value={seed} onChange={setSeed} layout="inline" />
                    <IconButton description="Randomize seed" onPress={() => setSeed(generateId())}>
                        <ArrowClockwise />
                    </IconButton>
                </Box>
                <ColorSchemeToggleButton />
            </Box>

            <Box display="flex" flexDirection="row" gap="4" flexWrap="wrap">
                {themeColors.map(color => (
                    <DocumentBlobsPreview
                        key={color}
                        settings={{...settings, baseThemeColor: color}}
                    />
                ))}
            </Box>
        </Box>
    );
}

const targetWidth = 1200;
const aspectRatio = 4 / 3;
function DocumentBlobsPreview({settings}: {settings: DocumentBlobFactorySettings}) {
    const id = useId().replace(/:/g, "_");
    const containerRef = useRef<HTMLDivElement>(null);
    const containerRect = useResizeObserver(containerRef);

    const editorState = useConstant(() => ContentEditorState.create(documentContent));

    return (
        <Box
            ref={containerRef}
            style={{flexBasis: 400}}
            flex="auto"
            display="flex"
            flexDirection="column"
            gap="2"
            justifyContent="center"
            alignItems="stretch"
        >
            <Box
                style={{aspectRatio: `${aspectRatio}`}}
                boxShadow="elevation-10"
                borderRadius="base"
                overflow="hidden"
                position="relative"
                flex="auto"
            >
                {containerRect && (
                    <div
                        id={id}
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            pointerEvents: "none",
                            width: targetWidth,
                            height: targetWidth / aspectRatio,
                            transformOrigin: "top left",
                            transform: `scale(${containerRect.width / targetWidth})`,
                        }}
                    >
                        <DocumentBlobFactory settings={settings} containerId={id} />
                        <ContentEditor
                            state={editorState}
                            onChange={noop}
                            aria-label="Document editor"
                            placeholder="Share your ideas…"
                            className={sprinkles({paddingBottom: "24"})}
                        />
                    </div>
                )}
            </Box>
            <Box textAlign="center">{settings.baseThemeColor}</Box>
        </Box>
    );
}

const documentContent = dummyDocumentContent();
