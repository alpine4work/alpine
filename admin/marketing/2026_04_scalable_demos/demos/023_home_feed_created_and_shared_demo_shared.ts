import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const homeFeedCreatedAndSharedDemoRecording01FirstFrameWithoutPadding = 172;
const homeFeedCreatedAndSharedDemoRecording01LastFrameWithoutPadding = 1563;

export const homeFeedCreatedAndSharedDemoRecording01FirstFrame =
    homeFeedCreatedAndSharedDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const homeFeedCreatedAndSharedDemoRecording01LastFrame =
    homeFeedCreatedAndSharedDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const homeFeedCreatedAndSharedDemoDurationInFrames =
    homeFeedCreatedAndSharedDemoRecording01LastFrame -
    homeFeedCreatedAndSharedDemoRecording01FirstFrame;
