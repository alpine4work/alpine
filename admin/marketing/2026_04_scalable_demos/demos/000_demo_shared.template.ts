import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const __demoName__DemoRecording01FirstFrameWithoutPadding = 30;
const __demoName__DemoRecording01LastFrameWithoutPadding = 1000;

export const __demoName__DemoRecording01FirstFrame =
    __demoName__DemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const __demoName__DemoRecording01LastFrame =
    __demoName__DemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const __demoName__DemoDurationInFrames =
    __demoName__DemoRecording01LastFrame - __demoName__DemoRecording01FirstFrame;
