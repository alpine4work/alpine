import {ArrowClockwise} from "@phosphor-icons/react";
import {useId, useState} from "react";
import {
    DocumentBlobFactory,
    DocumentBlobFactorySettings,
    useDocumentBlobSettings,
} from "~/client/blob_factory/document_blobs";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {ColorSchemeToggleButton} from "~/client/design/playground/color_scheme_toggle_button";
import {TextInput} from "~/client/design/text_input";
import {useConstant} from "~/client/helpers/lifecycle/use_constant";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {dummyDocumentContent} from "~/shared/content/dummy_document_content";
import {themeColors} from "~/shared/design/theme_colors";
import {generateId} from "~/shared/id/id";
import {emptyContentReferences} from "~/shared/models/content_references";
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
    const [containerRef, containerRect] = useResizeObserver();

    const content = useConstant(() => ({
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
