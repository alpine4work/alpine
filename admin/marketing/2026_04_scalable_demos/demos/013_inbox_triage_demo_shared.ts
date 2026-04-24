import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const inboxTriageDemoRecording01FirstFrameWithoutPadding = 360;
const inboxTriageDemoRecording01LastFrameWithoutPadding = 1400 + 360;

export const inboxTriageDemoRecording01FirstFrame =
    inboxTriageDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const inboxTriageDemoRecording01LastFrame =
    inboxTriageDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const inboxTriageDemoDurationInFrames =
    inboxTriageDemoRecording01LastFrame - inboxTriageDemoRecording01FirstFrame;
