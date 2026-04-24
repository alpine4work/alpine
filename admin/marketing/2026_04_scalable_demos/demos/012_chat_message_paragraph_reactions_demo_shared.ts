import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const chatMessageParagraphReactionsDemoRecording01FirstFrameWithoutPadding = 250;
const chatMessageParagraphReactionsDemoRecording01LastFrameWithoutPadding = 1200;

export const chatMessageParagraphReactionsDemoRecording01JumpCuts = [
    {
        // shorten loading indicator
        startFrame: 20 + chatMessageParagraphReactionsDemoRecording01FirstFrameWithoutPadding,
        endFrame: 133 + chatMessageParagraphReactionsDemoRecording01FirstFrameWithoutPadding,
    },
];

export const chatMessageParagraphReactionsDemoRecording01Zoom = 1.5;

export const chatMessageParagraphReactionsDemoRecording01FirstFrame =
    chatMessageParagraphReactionsDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const chatMessageParagraphReactionsDemoRecording01LastFrame =
    chatMessageParagraphReactionsDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const chatMessageParagraphReactionsDemoDurationInFrames =
    chatMessageParagraphReactionsDemoRecording01LastFrame -
    chatMessageParagraphReactionsDemoRecording01FirstFrame -
    chatMessageParagraphReactionsDemoRecording01JumpCuts.reduce(
        (frames, {startFrame, endFrame}) => frames + (endFrame - startFrame),
        0,
    );
