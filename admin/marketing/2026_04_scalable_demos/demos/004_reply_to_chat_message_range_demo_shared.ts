import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {
    scalableDemoNarrowViewportSpacingScale,
    scalableDemoNarrowViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export const replyToChatMessageRangeDemoRecordingWidth =
    scalableDemoNarrowViewportWidth -
    convertRemLengthToPx(scalableDemoSpaceSideBarWidth, scalableDemoNarrowViewportSpacingScale);

export const replyToChatMessageRangeDemoRecordingHeight =
    Math.round(scalableDemoNarrowViewportWidth / goldenRatio) - 9;

const replyToChatMessageRangeDemoRecording01FirstFrameWithoutPadding = 265;
const replyToChatMessageRangeDemoRecording01LastFrameWithoutPadding = 868;

export const replyToChatMessageRangeDemoRecording01FirstFrame =
    replyToChatMessageRangeDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const replyToChatMessageRangeDemoRecording01LastFrame =
    replyToChatMessageRangeDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const replyToChatMessageRangeDemoDurationInFrames =
    replyToChatMessageRangeDemoRecording01LastFrame -
    replyToChatMessageRangeDemoRecording01FirstFrame;
