import {ArrowClockwise} from "phosphor-react";
import {useId, useState} from "react";
import {
    DocumentBlobFactory,
    DocumentBlobFactorySettings,
    useDocumentBlobSettings,
} from "~/client/blob_factory/document_blobs.js";
import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {ColorSchemeToggleButton} from "~/client/design/playground/color_scheme_toggle_button.js";
import {TextInput} from "~/client/design/text_input.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {sprinkles} from "~/client/styles/styles.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {themeColors} from "~/shared/design/core/theme_colors.js";
import {dummyDocumentContent} from "~/shared/documents/fixtures/communist_manifesto_document_content.js";
import {generateId} from "~/shared/id/id.js";

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
                    <TextInput
                        label="Seed"
                        value={seed}
                        onChange={setSeed}
                        // TODO(calebmer): We removed the inline layout mode. We should refactor this
                        // to use `<TextInputWithoutLabel>`.
                        // layout="inline"
                    />
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
    const [containerRef, containerRect] = useResizeObserver();

    const [content] = useState(() => ({
        doc: dummyDocumentContent.get(),
        references: emptyContentReferences,
    }));

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
                borderRadius="1"
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
                        <ContentView
                            content={content}
                            className={sprinkles({paddingBottom: "24"})}
                        />
                    </div>
                )}
            </Box>
            <Box textAlign="center">{settings.baseThemeColor}</Box>
        </Box>
    );
}
