import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {scalableDemoNarrowViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export const exportTableToMarkdownDemoRecordingWidth = scalableDemoNarrowViewportWidth;
export const exportTableToMarkdownDemoRecordingHeight =
    Math.round(scalableDemoNarrowViewportWidth / goldenRatio) - 2;

const exportTableToMarkdownDemoRecording01FirstFrameWithoutPadding = 579;
const exportTableToMarkdownDemoRecording01LastFrameWithoutPadding = 1315;

export const exportTableToMarkdownDemoRecording01FirstFrame =
    exportTableToMarkdownDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 3;
export const exportTableToMarkdownDemoRecording01LastFrame =
    exportTableToMarkdownDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const exportTableToMarkdownDemoDurationInFrames =
    exportTableToMarkdownDemoRecording01LastFrame - exportTableToMarkdownDemoRecording01FirstFrame;
