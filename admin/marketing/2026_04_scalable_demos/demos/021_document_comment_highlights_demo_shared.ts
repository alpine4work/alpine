import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

const documentCommentHighlightsDemoRecording01FirstFrameWithoutPadding = 30;
const documentCommentHighlightsDemoRecording01LastFrameWithoutPadding = 875;

export const documentCommentHighlightsDemoRecording01FirstFrame =
    documentCommentHighlightsDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const documentCommentHighlightsDemoRecording01LastFrame =
    documentCommentHighlightsDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const documentCommentHighlightsDemoDurationInFrames =
    documentCommentHighlightsDemoRecording01LastFrame -
    documentCommentHighlightsDemoRecording01FirstFrame;
