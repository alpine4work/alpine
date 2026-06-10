import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const chatgptCursorBugFixDemoRecording01FirstFrameWithoutPadding = 200;
const chatgptCursorBugFixDemoRecording01LastFrameWithoutPadding = 1065;

export const chatgptCursorBugFixDemoRecording01FirstFrame =
    chatgptCursorBugFixDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 6;
export const chatgptCursorBugFixDemoRecording01LastFrame =
    chatgptCursorBugFixDemoRecording01LastFrameWithoutPadding + scalableDemoFps;

export const chatgptCursorBugFixDemoDurationInFrames =
    chatgptCursorBugFixDemoRecording01LastFrame - chatgptCursorBugFixDemoRecording01FirstFrame;
