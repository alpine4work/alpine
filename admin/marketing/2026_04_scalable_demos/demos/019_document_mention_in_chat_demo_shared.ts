import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {
    scalableDemoNarrowViewportSpacingScale,
    scalableDemoNarrowViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export const documentMentionInChatDemoRecordingWidth =
    scalableDemoNarrowViewportWidth -
    convertRemLengthToPx(scalableDemoSpaceSideBarWidth, scalableDemoNarrowViewportSpacingScale) -
    12;

export const documentMentionInChatDemoRecordingHeight =
    Math.round(scalableDemoNarrowViewportWidth / goldenRatio) + 16;

const documentMentionInChatDemo01FirstFrameWithoutPadding = 150;
const documentMentionInChatDemoRecording01LastFrameWithoutPadding = 550;

export const documentMentionInChatDemoRecording01FirstFrame =
    documentMentionInChatDemo01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const documentMentionInChatDemoRecording01LastFrame =
    documentMentionInChatDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const documentMentionInChatDemoDurationInFrames =
    documentMentionInChatDemoRecording01LastFrame - documentMentionInChatDemoRecording01FirstFrame;
