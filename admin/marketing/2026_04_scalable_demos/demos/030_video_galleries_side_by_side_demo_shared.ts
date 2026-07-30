import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export const videoGalleriesSideBySideDemoWidth = 1280 + 200;
export const videoGalleriesSideBySideDemoHeight =
    Math.round(videoGalleriesSideBySideDemoWidth / goldenRatio) - 8;

const videoGalleriesSideBySideDemoRecording01FirstFrameWithoutPadding = 224;
const videoGalleriesSideBySideDemoRecording01LastFrameWithoutPadding = 885;

export const videoGalleriesSideBySideDemoRecording01JumpCuts = [
    {
        startFrame: 285,
        endFrame: 345,
    },
];

export const videoGalleriesSideBySideDemoRecording01FirstFrame =
    videoGalleriesSideBySideDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 2;
export const videoGalleriesSideBySideDemoRecording01LastFrame =
    videoGalleriesSideBySideDemoRecording01LastFrameWithoutPadding + scalableDemoFps / 5;

export const videoGalleriesSideBySideDemoDurationInFrames =
    videoGalleriesSideBySideDemoRecording01LastFrame -
    videoGalleriesSideBySideDemoRecording01FirstFrame -
    videoGalleriesSideBySideDemoRecording01JumpCuts.reduce(
        (frames, {startFrame, endFrame}) => frames + (endFrame - startFrame),
        0,
    );
