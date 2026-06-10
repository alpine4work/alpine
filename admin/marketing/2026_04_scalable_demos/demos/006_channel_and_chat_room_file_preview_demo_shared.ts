import {scalableDemoDefaultViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

export const channelAndChatRoomFilePreviewDemoRecordingWidth = scalableDemoDefaultViewportWidth;

export const channelAndChatRoomFilePreviewDemoRecordingHeight =
    Math.round(channelAndChatRoomFilePreviewDemoRecordingWidth * (3 / 4)) - 8;

const channelAndChatRoomFilePreviewDemoRecordingFirstFrameWithoutPadding = 443;
const channelAndChatRoomFilePreviewDemoRecordingLastFrameWithoutPadding = 1603;

// Jump cut segments. Start frame is inclusive, last frame is exclusive.
export const channelAndChatRoomFilePreviewDemoRecordingJumpCuts = [
    {startFrame: 553, endFrame: 1213 - scalableDemoFps},
];

export const channelAndChatRoomFilePreviewDemoRecordingFirstFrame =
    channelAndChatRoomFilePreviewDemoRecordingFirstFrameWithoutPadding - scalableDemoFps / 2;
export const channelAndChatRoomFilePreviewDemoRecordingLastFrame =
    channelAndChatRoomFilePreviewDemoRecordingLastFrameWithoutPadding + scalableDemoFps / 4;

export const channelAndChatRoomFilePreviewDemoDurationInFrames =
    channelAndChatRoomFilePreviewDemoRecordingLastFrame -
    channelAndChatRoomFilePreviewDemoRecordingFirstFrame -
    channelAndChatRoomFilePreviewDemoRecordingJumpCuts.reduce(
        (frames, {startFrame, endFrame}) => frames + (endFrame - startFrame),
        0,
    ) -
    1;
