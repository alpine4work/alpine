import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export const documentFileFloatDemoWidth = 1280 + 200;
export const documentFileFloatDemoHeight = Math.round(documentFileFloatDemoWidth / goldenRatio);

const documentFileFloatDemoRecording01FirstFrameWithoutPadding = 30;
const documentFileFloatDemoRecording01LastFrameWithoutPadding = 720;

export const documentFileFloatDemoRecording01FirstFrame =
    documentFileFloatDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const documentFileFloatDemoRecording01LastFrame =
    documentFileFloatDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const documentFileFloatDemoDurationInFrames =
    documentFileFloatDemoRecording01LastFrame - documentFileFloatDemoRecording01FirstFrame;
