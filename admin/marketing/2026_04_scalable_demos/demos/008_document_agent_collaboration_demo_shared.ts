import {scalableDemoDefaultViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

export const documentAgentCollaborationDemoRecordingWidth = scalableDemoDefaultViewport.width;

export const documentAgentCollaborationDemoRecordingHeight = scalableDemoDefaultViewport.height - 9;

const documentAgentCollaborationDemoRecordingFirstFrameWithoutPadding = 75;
const documentAgentCollaborationDemoRecordingLastFrameWithoutPadding = 3658;

// Jump cut segments. Start frame is inclusive, last frame is exclusive.
export const documentAgentCollaborationDemoRecordingJumpCuts = [
    {startFrame: 466 + scalableDemoFps / 2, endFrame: 3078 - scalableDemoFps / 2},
    {startFrame: 3114, endFrame: 3561},

    // Another option where we show the thinking indicator (though the thinking
    // indicator looks broken?)
    //
    // ```
    // {startFrame: 3114, endFrame: 3247},
    // {startFrame: 3247 + scalableDemoFps, endFrame: 3561},
    // ```
];

export const documentAgentCollaborationDemoRecordingFirstFrame =
    documentAgentCollaborationDemoRecordingFirstFrameWithoutPadding - scalableDemoFps / 4;
export const documentAgentCollaborationDemoRecordingLastFrame =
    documentAgentCollaborationDemoRecordingLastFrameWithoutPadding + scalableDemoFps;

export const documentAgentCollaborationDemoDurationInFrames =
    documentAgentCollaborationDemoRecordingLastFrame -
    documentAgentCollaborationDemoRecordingFirstFrame -
    documentAgentCollaborationDemoRecordingJumpCuts.reduce(
        (frames, {startFrame, endFrame}) => frames + (endFrame - startFrame),
        0,
    ) -
    documentAgentCollaborationDemoRecordingJumpCuts.length;
