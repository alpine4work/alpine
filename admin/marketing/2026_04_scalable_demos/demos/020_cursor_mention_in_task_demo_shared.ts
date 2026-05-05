import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const cursorMentionInTaskDemoRecording01FirstFrameWithoutPadding = 130;
const cursorMentionInTaskDemoRecording01LastFrameWithoutPadding = 800;

export const cursorMentionInTaskDemoRecording01FirstFrame =
    cursorMentionInTaskDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const cursorMentionInTaskDemoRecording01LastFrame =
    cursorMentionInTaskDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const cursorMentionInTaskDemoDurationInFrames =
    cursorMentionInTaskDemoRecording01LastFrame - cursorMentionInTaskDemoRecording01FirstFrame;
