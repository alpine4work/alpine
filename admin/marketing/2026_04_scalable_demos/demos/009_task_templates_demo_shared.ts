import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {
    scalableDemoWideViewport,
    scalableDemoWideViewportSpacingScale,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export const taskTemplatesDemoRecordingWidth =
    scalableDemoWideViewport.width -
    convertRemLengthToPx(scalableDemoSpaceSideBarWidth, scalableDemoWideViewportSpacingScale);

export const taskTemplatesDemoRecordingHeight = scalableDemoWideViewport.height - 6;

const taskTemplatesDemoRecordingFirstFrameWithoutPadding = 275;
const taskTemplatesDemoRecordingLastFrameWithoutPadding = 1581;

export const taskTemplatesDemoRecordingFirstFrame =
    taskTemplatesDemoRecordingFirstFrameWithoutPadding - scalableDemoFps / 4;
export const taskTemplatesDemoRecordingLastFrame =
    taskTemplatesDemoRecordingLastFrameWithoutPadding + scalableDemoFps / 2;

export const taskTemplatesDemoDurationInFrames =
    taskTemplatesDemoRecordingLastFrame - taskTemplatesDemoRecordingFirstFrame;
