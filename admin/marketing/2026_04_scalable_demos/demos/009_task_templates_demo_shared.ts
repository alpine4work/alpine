import {
    scalableDemoDefaultViewport,
    scalableDemoDefaultViewportSpacingScale,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export const taskTemplatesDemoRecordingWidth =
    scalableDemoDefaultViewport.width -
    convertRemLengthToPx(scalableDemoSpaceSideBarWidth, scalableDemoDefaultViewportSpacingScale);

export const taskTemplatesDemoRecordingHeight = scalableDemoDefaultViewport.height - 6;

const taskTemplatesDemoRecordingFirstFrameWithoutPadding = 275;
const taskTemplatesDemoRecordingLastFrameWithoutPadding = 1581;

export const taskTemplatesDemoRecordingFirstFrame =
    taskTemplatesDemoRecordingFirstFrameWithoutPadding - scalableDemoFps / 4;
export const taskTemplatesDemoRecordingLastFrame =
    taskTemplatesDemoRecordingLastFrameWithoutPadding + scalableDemoFps / 2;

export const taskTemplatesDemoDurationInFrames =
    taskTemplatesDemoRecordingLastFrame - taskTemplatesDemoRecordingFirstFrame;
