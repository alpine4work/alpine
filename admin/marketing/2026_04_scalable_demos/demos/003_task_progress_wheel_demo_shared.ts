import {
    scalableDemoDefaultViewportWidth,
    scalableDemoNarrowViewportSpacingScale,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export const taskProgressWheelDemoRecordingWidth =
    scalableDemoDefaultViewportWidth -
    convertRemLengthToPx(scalableDemoSpaceSideBarWidth, scalableDemoNarrowViewportSpacingScale);

export const taskProgressWheelDemoRecordingMarginY = 32;

export const taskProgressWheelDemoRecordingHeight =
    taskProgressWheelDemoRecordingWidth / goldenRatio;

const taskProgressWheelDemoRecording01FirstFrameWithoutPadding = 725;
const taskProgressWheelDemoRecording01LastFrameWithoutPadding = 1427;

export const taskProgressWheelDemoRecording01ExpandedChildTasksFrame = 735;
export const taskProgressWheelDemoRecording01CollapsedChildTasksFrame = 1416;

export const taskProgressWheelDemoRecording01FirstFrameFreezePadding = scalableDemoFps / 2;

export const taskProgressWheelDemoRecording01FirstFrame =
    taskProgressWheelDemoRecording01FirstFrameWithoutPadding -
    taskProgressWheelDemoRecording01FirstFrameFreezePadding;
export const taskProgressWheelDemoRecording01LastFrame =
    taskProgressWheelDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const taskProgressWheelDemoDurationInFrames =
    taskProgressWheelDemoRecording01LastFrame - taskProgressWheelDemoRecording01FirstFrame;
