import {
    scalableDemoDefaultViewportWidth,
    scalableDemoNarrowViewportSpacingScale,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export const imageGalleryDemoRecordingWidth =
    scalableDemoDefaultViewportWidth -
    convertRemLengthToPx(scalableDemoSpaceSideBarWidth, scalableDemoNarrowViewportSpacingScale);

export const imageGalleryDemoRecordingPaddingTop = 16;
export const imageGalleryDemoRecordingHeight = 536 + imageGalleryDemoRecordingPaddingTop;

const imageGalleryDemoRecording01FirstFrameWithoutPadding = 1023;
const imageGalleryDemoRecording01LastFrameWithoutPadding = 1522;

// Jump cut segments. Start frame is inclusive, last frame is exclusive.
export const imageGalleryDemoRecordingJumpCuts = [
    {startFrame: 1247, endFrame: 1254},
    {startFrame: 1300, endFrame: 1301},
    {startFrame: 1374, endFrame: 1380},
    {startFrame: 1502, endFrame: 1522},
];

export const imageGalleryDemoRecording01FirstFrame =
    imageGalleryDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const imageGalleryDemoRecording01LastFrame =
    imageGalleryDemoRecording01LastFrameWithoutPadding + scalableDemoFps * 2;

export const imageGalleryDemoDurationInFrames =
    imageGalleryDemoRecording01LastFrame -
    imageGalleryDemoRecording01FirstFrame -
    imageGalleryDemoRecordingJumpCuts.reduce(
        (frames, {startFrame, endFrame}) => frames + (endFrame - startFrame),
        0,
    );
