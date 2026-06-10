import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const searchTasksClosedByMasonLastWeekDemoRecording01FirstFrameWithoutPadding = 213;
const searchTasksClosedByMasonLastWeekDemoRecording01LastFrameWithoutPadding = 900;

export const searchTasksClosedByMasonLastWeekDemoRecording01FirstFrame =
    searchTasksClosedByMasonLastWeekDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const searchTasksClosedByMasonLastWeekDemoRecording01LastFrame =
    searchTasksClosedByMasonLastWeekDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const searchTasksClosedByMasonLastWeekDemoDurationInFrames =
    searchTasksClosedByMasonLastWeekDemoRecording01LastFrame -
    searchTasksClosedByMasonLastWeekDemoRecording01FirstFrame;
