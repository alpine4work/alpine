import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const feedPostWithCollectionPreviewDemoRecording01FirstFrameWithoutPadding = 380;
const feedPostWithCollectionPreviewDemoRecording01LastFrameWithoutPadding = 1075;

export const feedPostWithCollectionPreviewDemoRecording01FirstFrame =
    feedPostWithCollectionPreviewDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const feedPostWithCollectionPreviewDemoRecording01LastFrame =
    feedPostWithCollectionPreviewDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const feedPostWithCollectionPreviewDemoDurationInFrames =
    feedPostWithCollectionPreviewDemoRecording01LastFrame -
    feedPostWithCollectionPreviewDemoRecording01FirstFrame;
