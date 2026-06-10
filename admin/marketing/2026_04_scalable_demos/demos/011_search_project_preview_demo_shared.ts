import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const searchProjectPreviewDemoRecording01FirstFrameWithoutPadding = 410;
const searchProjectPreviewDemoRecording01LastFrameWithoutPadding = 1556;

// Jump cut segments. Start frame is inclusive, last frame is exclusive.
export const searchProjectPreviewDemoRecording01JumpCuts = [
    // cut out Ctrl + V modal
    {
        startFrame: 712 + searchProjectPreviewDemoRecording01FirstFrameWithoutPadding,
        endFrame: 940 + searchProjectPreviewDemoRecording01FirstFrameWithoutPadding,
    },
];

export const searchProjectPreviewDemoRecording01FirstFrame =
    searchProjectPreviewDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const searchProjectPreviewDemoRecording01LastFrame =
    searchProjectPreviewDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const searchProjectPreviewDemoDurationInFrames =
    searchProjectPreviewDemoRecording01LastFrame -
    searchProjectPreviewDemoRecording01FirstFrame -
    searchProjectPreviewDemoRecording01JumpCuts.reduce(
        (frames, {startFrame, endFrame}) => frames + (endFrame - startFrame),
        0,
    );
