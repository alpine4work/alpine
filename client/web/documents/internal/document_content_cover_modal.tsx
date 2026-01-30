import {Check, DiceSix} from "phosphor-react";
import {RefObject, useCallback, useEffect, useId, useMemo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {BlobsArt} from "~/client/web/blobs/blobs_art.js";
import {ContentEditorRef} from "~/client/web/content/content_editor.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {Modal} from "~/client/web/design/modal.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarHeight,
} from "~/client/web/design/navigation_bar_helpers.js";
import {NavigationBarContent} from "~/client/web/navigation/navigation_bar_content.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {
    searchModalMaxHeight,
    searchModalMaxWidth,
} from "~/client/web/styles/search_shared_styles.js";
import {
    backgroundFontSizePercentage,
    buttonStyles,
    colorSchemeVars,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {interFontAscender, interFontDescender} from "~/shared/design/core/font_metrics.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {DocumentContentCover} from "~/shared/documents/document_content_cover.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {randomArrayItem} from "~/shared/helpers/array/random_array_item.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

function DocumentContentCoverBlobsArtOption({
    blob,
    index,
    isSelected,
    onPress,
}: {
    blob: NonNullable<DocumentContentCover>;
    index: number;
    isSelected: boolean;
    onPress: (index: number) => void;
}) {
    const platform = usePlatform();

    const memoizedSettings = useMemo(
        () => ({
            seed: blob.seed,
            themeColor: blob.themeColor,
            hueSpread: blob.hueSpread,
        }),
        [blob],
    );

    const {isPressed, pressProps} = usePress({onPress: () => onPress(index)});

    return (
        <FocusRing offset="border">
            <Box
                {...pressProps}
                tabIndex={0}
                overflow="hidden"
                position="relative"
                boxShadow="elevation-5-without-border"
                borderRadius="1.5"
                data-testid={
                    process.env.NODE_ENV !== "production"
                        ? "DocumentContentCoverBlobsArtOption"
                        : undefined
                }
            >
                <Box
                    // Render a border using an absolutely positioned `<div>` instead of using
                    // `elevation-5-with-grey-10-border` because we need the border to render on top
                    // of UI in the `<BlobsArt>`.
                    position="absolute"
                    inset="0"
                    zIndex="60"
                    pointerEvents="none"
                    borderRadius="1.5"
                    style={{border: `solid 1px ${colorSchemeVars["grey-10-translucent"]}`}}
                />
                {isPressed && (
                    <Box
                        zIndex="50"
                        position="absolute"
                        inset="0"
                        backgroundColor="grey-100-const"
                        pointerEvents="none"
                        style={{opacity: buttonStyles.buttonPressedOverlayOpacity}}
                    />
                )}
                <Box overflow="hidden" height="full" width="full">
                    <BlobsArt settings={memoizedSettings} scale={0.35} />
                </Box>
                {isSelected && (
                    <Box
                        position="absolute"
                        zIndex="40"
                        right={platform === "mobile" ? "2" : "3"}
                        bottom={platform === "mobile" ? "2" : "3"}
                        height="7"
                        width="7"
                        borderRadius="full"
                        backgroundColor="grey-90"
                        color="grey-0"
                        opacity="80"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                    >
                        <Check />
                    </Box>
                )}
            </Box>
        </FocusRing>
    );
}

const optionCount = 6;
type BlobCoverOptionsType = Array<NonNullable<DocumentContentCover>>;

// We only use a subset of the theme colors to avoid colors that look too close.
const colorOptions: Array<ThemeColor> = ["red", "yellow", "orange", "green", "blue", "purple"];
// Most hue spreads are pretty tame, but usually show one with a much larger spread.
const hueSpreadOptions = [10, 15, 20, 25, 30, 45, 80];

function createOptions(
    selectedBlob: NonNullable<DocumentContentCover> | undefined,
    selectedBlobOption: number | null,
): BlobCoverOptionsType {
    let colorsRemaining = colorOptions.filter(color => color !== selectedBlob?.themeColor);
    let hueSpreadRemaining = hueSpreadOptions;
    const options: BlobCoverOptionsType = [];

    while (options.length < optionCount) {
        // refill remaining colors and hue spreads if we run out
        if (colorsRemaining.length === 0) {
            colorsRemaining = colorOptions;
        }

        if (hueSpreadRemaining.length === 0) {
            hueSpreadRemaining = hueSpreadOptions;
        }

        // If we have a selected blob, keep it at the same position
        const blob: NonNullable<DocumentContentCover> =
            selectedBlob && options.length === selectedBlobOption
                ? selectedBlob
                : {
                      type: "Blobs",
                      seed: crypto.randomUUID(),
                      themeColor: randomArrayItem(colorsRemaining),
                      hueSpread: randomArrayItem(hueSpreadRemaining),
                  };

        options.push(blob);
        colorsRemaining = colorsRemaining.filter(color => color !== blob.themeColor);
        hueSpreadRemaining = hueSpreadRemaining.filter(hueSpread => hueSpread !== blob.hueSpread);
    }

    return options;
}

export function DocumentContentCoverModal({
    editorRef,
    editorState,
    onClose,
}: {
    editorRef: RefObject<ContentEditorRef<DocumentContentWithReferences> | null>;
    editorState: ContentEditorState<DocumentContentWithReferences>;
    onClose: () => void;
}) {
    const platform = usePlatform();
    const isMobile = platform === "mobile";
    const currentlySetDocumentContentCover = editorState.getDoc().attrs.cover;

    const [selectedBlobOption, setSelectedBlobOption] = useState<number | null>(
        currentlySetDocumentContentCover ? 0 : null,
    );

    // Keep a ref to the selected blob option so we can use it without running
    // effects on change.
    const selectedBlobOptionRef = useRef<typeof selectedBlobOption>(selectedBlobOption);
    useEffect(() => {
        selectedBlobOptionRef.current = selectedBlobOption;
    }, [selectedBlobOption]);

    const [blobOptions, setBlobOptions] = useState(() => {
        const blobsCover =
            currentlySetDocumentContentCover?.type === "Blobs"
                ? currentlySetDocumentContentCover
                : null;
        return createOptions(blobsCover, blobsCover ? 0 : null);
    });

    // If content cover changes on another client, update it here
    useEffect(() => {
        if (isMobile) return;

        if (
            currentlySetDocumentContentCover === null ||
            currentlySetDocumentContentCover.type !== "Blobs"
        ) {
            // If the cover is set to null or is not Blobs, we can just shortcut here.
            setSelectedBlobOption(null);
            return;
        }

        const currentlySetBlobOption = blobOptions.findIndex(
            blob =>
                blob.seed === currentlySetDocumentContentCover.seed &&
                blob.themeColor === currentlySetDocumentContentCover.themeColor &&
                blob.hueSpread === currentlySetDocumentContentCover.hueSpread,
        );

        // Nothing to do
        if (currentlySetBlobOption === selectedBlobOptionRef.current) return;

        // Somehow we randomly generated the same one, so just update it
        if (currentlySetBlobOption !== -1) {
            setSelectedBlobOption(currentlySetBlobOption);
            return;
        }

        // We don't have a copy of the new cover, so let's find the first index that's not
        // the same blob, set it in the blob options, then set it as selected.
        const firstIndexThatIsNotTheSameBlob = blobOptions.findIndex(
            blob =>
                blob.seed !== currentlySetDocumentContentCover.seed ||
                blob.themeColor !== currentlySetDocumentContentCover.themeColor ||
                blob.hueSpread !== currentlySetDocumentContentCover.hueSpread,
        );

        assert(firstIndexThatIsNotTheSameBlob !== -1);

        // Update the blob options
        setBlobOptions(blobOptions => {
            const newBlobOptions = [...blobOptions];
            newBlobOptions[firstIndexThatIsNotTheSameBlob] = currentlySetDocumentContentCover;
            return newBlobOptions;
        });

        setSelectedBlobOption(firstIndexThatIsNotTheSameBlob);
    }, [isMobile, currentlySetDocumentContentCover, blobOptions]);

    const onRefresh = useCallback(() => {
        setBlobOptions(
            createOptions(
                selectedBlobOption !== null ? blobOptions[selectedBlobOption] : undefined,
                selectedBlobOption,
            ),
        );
    }, [selectedBlobOption, blobOptions]);

    const onSave = useCallback(
        (overrideSelectedBlobOption?: number | null) => {
            const editor = assertExists(editorRef.current);
            const newBlobOption =
                overrideSelectedBlobOption !== undefined
                    ? overrideSelectedBlobOption
                    : selectedBlobOption;

            if (newBlobOption === null || newBlobOption >= blobOptions.length) {
                editor.setCover(null);
            } else {
                const selection = assertExists(blobOptions[newBlobOption]);

                editor.setCover({
                    type: "Blobs",
                    seed: selection.seed,
                    themeColor: selection.themeColor,
                    hueSpread: selection.hueSpread,
                });
            }

            if (isMobile) {
                onClose();
            }
        },
        [editorRef, selectedBlobOption, blobOptions, isMobile, onClose],
    );

    const onSelectBlobOption = useCallback(
        (index: number | null) => {
            // If we're not on mobile, let's immediately set the cover
            if (!isMobile) {
                onSave(index);
            }

            setSelectedBlobOption(index);
        },
        [isMobile, onSave],
    );

    if (isMobile) {
        const saveDisabled =
            (!currentlySetDocumentContentCover && selectedBlobOption === null) ||
            (selectedBlobOption !== null &&
                currentlySetDocumentContentCover?.seed === blobOptions[selectedBlobOption]?.seed &&
                currentlySetDocumentContentCover?.themeColor ===
                    blobOptions[selectedBlobOption]?.themeColor &&
                currentlySetDocumentContentCover?.hueSpread ===
                    blobOptions[selectedBlobOption]?.hueSpread);

        return (
            <DocumentContentCoverModalMobileView
                blobOptions={blobOptions}
                selectedBlobOption={selectedBlobOption}
                onSelectBlobOption={onSelectBlobOption}
                onSave={onSave}
                onRefresh={onRefresh}
                onClose={onClose}
                saveDisabled={saveDisabled}
            />
        );
    } else {
        return (
            <DocumentContentCoverModalDesktopView
                blobOptions={blobOptions}
                selectedBlobOption={selectedBlobOption}
                onSelectBlobOption={onSelectBlobOption}
                onRefresh={onRefresh}
                onClose={onClose}
            />
        );
    }
}

function DocumentContentCoverModalDesktopView({
    blobOptions,
    selectedBlobOption,
    onSelectBlobOption,
    onRefresh,
    onClose,
}: {
    blobOptions: BlobCoverOptionsType;
    selectedBlobOption: number | null;
    onSelectBlobOption: (index: number | null) => void;
    onRefresh: () => void;
    onClose: () => void;
}) {
    const spacingScale = useSpacingScale();

    const titleId = useId();

    const titleFontSize = "300";

    // We want to baseline align our `fontSize="300"` title with our
    // centered `fontSize="75"` remove cover button. Calculate
    // the offset for center aligned `fontSize="300"` using font metrics.
    const buttonBaselineAlignmentMarginTop = useMemo(() => {
        const fontSize75 = fontSizesBySpacingScale["75"][spacingScale];

        const fontSize75Descender =
            fontSize75.fontSize *
            (backgroundFontSizePercentage - 1) *
            (interFontDescender / (interFontAscender + interFontDescender));

        const fontSize75BottomHalfHeight = fontSize75Descender + fontSize75.fontSize / 2;

        const fontSize300 = fontSizesBySpacingScale[titleFontSize][spacingScale];

        const fontSize300Descender =
            fontSize300.fontSize *
            (backgroundFontSizePercentage - 1) *
            (interFontDescender / (interFontAscender + interFontDescender));

        const fontSize300BottomHalfHeight = fontSize300Descender + fontSize300.fontSize / 2;

        return -1 * (-fontSize300BottomHalfHeight + fontSize75BottomHalfHeight);
    }, [spacingScale]);

    return (
        <Modal
            onClose={onClose}
            aria-labelledby={titleId}
            // Use the same, large, size as `<SearchModal>`.
            maxWidth={searchModalMaxWidth}
            height="full"
            maxHeight={searchModalMaxHeight}
            borderRadius="2.5"
            withoutCloseButton={true}
        >
            <Box display="flex" flexDirection="column" height="full">
                <Box
                    paddingX="7"
                    paddingTop="7"
                    flexShrink="0"
                    display="flex"
                    alignItems="center"
                    gap="2"
                >
                    <h2
                        id={titleId}
                        className={sprinkles({
                            userSelect: "text",
                            fontStyle: "bold",
                            fontSize: titleFontSize,
                        })}
                    >
                        Cover
                    </h2>
                    {selectedBlobOption !== null && (
                        <Box style={{marginTop: buttonBaselineAlignmentMarginTop}}>
                            <Button
                                variant="quietest"
                                height="6"
                                paddingX="1.5"
                                onPress={() => onSelectBlobOption(null)}
                            >
                                Remove cover
                            </Button>
                        </Box>
                    )}
                    <Box flexGrow="1" />
                    <Box marginRight="-1.5" style={{marginTop: buttonBaselineAlignmentMarginTop}}>
                        <Button
                            variant="quiet"
                            icon={<DiceSix size={spacing["4"]} />}
                            height="6"
                            paddingX="1.5"
                            onPress={() => onRefresh()}
                        >
                            Randomize
                        </Button>
                    </Box>
                </Box>
                <Box
                    flexGrow="1"
                    paddingX="7"
                    paddingTop="5"
                    paddingBottom="7"
                    gap="4"
                    style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(2, 1fr)`,
                        gridTemplateRows: `repeat(3, 1fr)`,
                    }}
                >
                    {blobOptions.map((option, index) => (
                        <DocumentContentCoverBlobsArtOption
                            key={index}
                            blob={option}
                            index={index}
                            isSelected={selectedBlobOption === index}
                            onPress={onSelectBlobOption}
                        />
                    ))}
                </Box>
            </Box>
        </Modal>
    );
}

function DocumentContentCoverModalMobileView({
    blobOptions,
    selectedBlobOption,
    saveDisabled,
    onSelectBlobOption,
    onSave,
    onClose,
    onRefresh,
}: {
    blobOptions: BlobCoverOptionsType;
    selectedBlobOption: number | null;
    saveDisabled: boolean;
    onSelectBlobOption: (index: number | null) => void;
    onSave: () => void;
    onClose: () => void;
    onRefresh: () => void;
}) {
    return (
        <MobileFullScreenModal onClose={onClose}>
            <Box display="flex" flexDirection="column" overflow="hidden" height="full">
                <Box flexShrink="0" height="safe-area-inset-top" />
                <NavigationBarContent
                    title="Edit cover"
                    replaceActions={
                        <Box
                            display="flex"
                            justifyContent="flex-end"
                            style={{width: mobileNavigationBarActionsWidthFittingFlexBasis}}
                        >
                            <Button
                                fontSize="100"
                                isDisabled={saveDisabled}
                                pressErrorTitle="Couldn\u2019t save cover"
                                onPress={() => {
                                    onSave();
                                }}
                            >
                                Save
                            </Button>
                        </Box>
                    }
                    // Instead of calling `navigate(-1)` the navigation bar needs a cancel button.
                    onMobileCancel={() => onClose()}
                />
                <Box
                    flexGrow="1"
                    gap="2"
                    paddingX={screenPaddingX}
                    style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(2, 1fr)`,
                        gridTemplateRows: `repeat(3, 1fr)`,
                    }}
                >
                    {blobOptions.map((option, index) => (
                        <DocumentContentCoverBlobsArtOption
                            key={index}
                            blob={option}
                            index={index}
                            isSelected={selectedBlobOption === index}
                            onPress={onSelectBlobOption}
                        />
                    ))}
                </Box>
                <Box
                    flexShrink="0"
                    height={navigationBarHeight}
                    paddingX={screenPaddingX}
                    display="flex"
                    alignItems="center"
                >
                    {selectedBlobOption !== null && (
                        <Button
                            variant="quietest"
                            height="6"
                            paddingX="1.5"
                            onPress={() => onSelectBlobOption(null)}
                        >
                            Remove cover
                        </Button>
                    )}
                    <Box flexGrow="1" />
                    <Button
                        variant="quiet"
                        icon={<DiceSix size={spacing["4"]} />}
                        height="6"
                        paddingX="1.5"
                        onPress={() => onRefresh()}
                    >
                        Randomize
                    </Button>
                </Box>
                <Box
                    flexShrink="0"
                    style={{
                        // Use `window-safe-area-inset-bottom` since it doesn't include the tab bar.
                        height: "var(--window-safe-area-inset-bottom, 0px)",
                    }}
                />
            </Box>
        </MobileFullScreenModal>
    );
}
