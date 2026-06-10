import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const shareTaskCollectionToChatDemoRecording01FirstFrameWithoutPadding = 312;
const shareTaskCollectionToChatDemoRecording01LastFrameWithoutPadding = 830;

export const shareTaskCollectionToChatDemoRecording01FirstFrame =
    shareTaskCollectionToChatDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const shareTaskCollectionToChatDemoRecording01LastFrame =
    shareTaskCollectionToChatDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const shareTaskCollectionToChatDemoDurationInFrames =
    shareTaskCollectionToChatDemoRecording01LastFrame -
    shareTaskCollectionToChatDemoRecording01FirstFrame;

export const shareTaskCollectionToChatDemoWidth = 1278;
export const shareTaskCollectionToChatDemoHeight = 780;
