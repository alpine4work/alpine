import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const shareSwitchDemoRecording01FirstFrameWithoutPadding = 272;
const shareSwitchDemoRecording01LastFrameWithoutPadding = 559;

export const shareSwitchDemoRecording01FirstFrame =
    shareSwitchDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const shareSwitchDemoRecording01LastFrame =
    shareSwitchDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const shareSwitchDemoDurationInFrames =
    shareSwitchDemoRecording01LastFrame - shareSwitchDemoRecording01FirstFrame;
