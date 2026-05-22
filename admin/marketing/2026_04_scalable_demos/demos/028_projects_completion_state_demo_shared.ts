import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const projectsCompletionStateDemoRecording01FirstFrameWithoutPadding = 295;
const projectsCompletionStateDemoRecording01LastFrameWithoutPadding = 800;

export const projectsCompletionStateDemoRecording01FirstFrame =
    projectsCompletionStateDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const projectsCompletionStateDemoRecording01LastFrame =
    projectsCompletionStateDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const projectsCompletionStateDemoDurationInFrames =
    projectsCompletionStateDemoRecording01LastFrame -
    projectsCompletionStateDemoRecording01FirstFrame;

export const projectsCompletionStateDemoWidth = 1280;
export const projectsCompletionStateDemoHeight = 782;
