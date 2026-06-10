import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {
    scalableDemoWideViewport,
    scalableDemoWideViewportSpacingScale,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export const pasteBulletListIntoTasksDemoRecordingPaddingTop = 48;
export const pasteBulletListIntoTasksDemoRecordingPaddingX = 48;

export const pasteBulletListIntoTasksDemoRecordingWidth =
    scalableDemoWideViewport.width -
    convertRemLengthToPx(scalableDemoSpaceSideBarWidth, scalableDemoWideViewportSpacingScale) +
    pasteBulletListIntoTasksDemoRecordingPaddingX * 2;

export const pasteBulletListIntoTasksDemoRecordingHeight =
    Math.round(scalableDemoWideViewport.width / goldenRatio) +
    pasteBulletListIntoTasksDemoRecordingPaddingTop -
    2;

const pasteBulletListIntoTasksDemoRecordingFirstFrameWithoutPadding = 635;
const pasteBulletListIntoTasksDemoRecordingLastFrameWithoutPadding = 2126;

// Jump cut segments. Start frame is inclusive, last frame is exclusive.
export const pasteBulletListIntoTasksDemoRecordingJumpCuts = [{startFrame: 1105, endFrame: 1381}];

export const pasteBulletListIntoTasksDemoRecordingFirstFrame =
    pasteBulletListIntoTasksDemoRecordingFirstFrameWithoutPadding - scalableDemoFps / 4;
export const pasteBulletListIntoTasksDemoRecordingLastFrame =
    pasteBulletListIntoTasksDemoRecordingLastFrameWithoutPadding + scalableDemoFps / 4;

export const pasteBulletListIntoTasksDemoDurationInFrames =
    pasteBulletListIntoTasksDemoRecordingLastFrame -
    pasteBulletListIntoTasksDemoRecordingFirstFrame -
    pasteBulletListIntoTasksDemoRecordingJumpCuts.reduce(
        (frames, {startFrame, endFrame}) => frames + (endFrame - startFrame),
        0,
    ) -
    1;
