import {
    scalableDemoDefaultViewportWidth,
    scalableDemoNarrowViewportSpacingScale,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export const postReactionsDemoRecordingWidth =
    scalableDemoDefaultViewportWidth -
    convertRemLengthToPx(scalableDemoSpaceSideBarWidth, scalableDemoNarrowViewportSpacingScale);

export const postReactionsDemoExtraHeight = 20;

export const postReactionsDemoRecordingHeight =
    Math.round(postReactionsDemoRecordingWidth / goldenRatio) + postReactionsDemoExtraHeight;

const postReactionsDemoRecordingFirstFrameWithoutPadding = 378;
const postReactionsDemoRecordingLastFrameWithoutPadding = 841;

export const postReactionsDemoRecordingFirstFrame =
    postReactionsDemoRecordingFirstFrameWithoutPadding - scalableDemoFps / 4;
export const postReactionsDemoRecordingLastFrame =
    postReactionsDemoRecordingLastFrameWithoutPadding + scalableDemoFps / 2;

export const postReactionsDemoDurationInFrames =
    postReactionsDemoRecordingLastFrame - postReactionsDemoRecordingFirstFrame;
