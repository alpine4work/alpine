import {Box} from "~/client/web/design/box.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";

// Same as `scrubberTrackHeightPx` in
// `content_file_video_and_audio_player_controls.css.ts`.
const trackHeightPx = 4;

/**
 * Progress bar for the Notion import process. Shows a horizontal bar with a
 * percentage label next to it. When complete, the percentage animates away and the
 * bar expands to fill the full width.
 */
export function NotionImportProgressBar({
    percentComplete,
    isFailed,
}: {
    percentComplete: number;
    isFailed?: boolean;
}) {
    const isComplete = percentComplete >= 100;

    return (
        <Box display="flex" alignItems="center" gap="4" height="2">
            <Box
                flex="1"
                borderRadius="full"
                backgroundColor="grey-10"
                overflow="hidden"
                style={{
                    height: trackHeightPx,
                    position: "relative",
                }}
            >
                <Box
                    position="absolute"
                    top="0"
                    bottom="0"
                    height="full"
                    borderRightRadius="full"
                    style={{
                        position: "absolute",
                        left: 0,
                        width: isComplete ? "100%" : `${percentComplete}%`,
                        backgroundColor: isFailed
                            ? colorSchemeVars["red-50"]
                            : colorSchemeVars["theme-40"],
                        transition: "width 300ms ease-out",
                    }}
                />
            </Box>
            {!isComplete && (
                <Box
                    fontSize="75"
                    color="grey-70"
                    fontStyle="semi-bold"
                    overflow="hidden"
                    style={{
                        fontVariantNumeric: "tabular-nums",
                    }}
                >
                    {percentComplete}%
                </Box>
            )}
        </Box>
    );
}
