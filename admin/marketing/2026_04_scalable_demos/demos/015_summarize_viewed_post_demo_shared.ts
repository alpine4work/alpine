import {scalableDemoDefaultViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

export const summarizeViewedPostDemoRecordingWidth = scalableDemoDefaultViewport.width;
export const summarizeViewedPostDemoRecordingHeight = scalableDemoDefaultViewport.height;

// Fill these in after recording: the frame of the first usable moment of take 1
// (Rose landing on the post) and the last usable moment of take 2 (Rose’s reply
// hitting the thread).
const summarizeViewedPostDemoRecordingFirstFrameWithoutPadding = 95;
const summarizeViewedPostDemoRecordingLastFrameWithoutPadding = 3320;

// The two takes are stitched together in a single `.mov`. Fill this in with the
// span between take 1 ending (message sent) and take 2 starting (agent beginning
// to stream) so the final video skips the handoff. Start is inclusive, end is
// exclusive. Add more entries if editing reveals other awkward beats worth
// cutting.
export const summarizeViewedPostDemoRecordingJumpCuts: Array<{
    startFrame: number;
    endFrame: number;
}> = [
    {startFrame: 522, endFrame: 548},
    {startFrame: 1177, endFrame: 1280},
    {startFrame: 1425, endFrame: 1601},
    {startFrame: 1613, endFrame: 1808},
    {startFrame: 1945, endFrame: 2084},
    {startFrame: 2202, endFrame: 2292},
    {startFrame: 2722, endFrame: 3132},
];

export const summarizeViewedPostDemoRecordingFirstFrame =
    summarizeViewedPostDemoRecordingFirstFrameWithoutPadding - scalableDemoFps / 2;
export const summarizeViewedPostDemoRecordingLastFrame =
    summarizeViewedPostDemoRecordingLastFrameWithoutPadding + scalableDemoFps / 5;

export const summarizeViewedPostDemoDurationInFrames =
    summarizeViewedPostDemoRecordingLastFrame -
    summarizeViewedPostDemoRecordingFirstFrame -
    summarizeViewedPostDemoRecordingJumpCuts.reduce(
        (frames, {startFrame, endFrame}) => frames + (endFrame - startFrame),
        0,
    );
