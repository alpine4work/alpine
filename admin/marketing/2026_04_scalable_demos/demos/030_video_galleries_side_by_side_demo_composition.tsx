import {
    videoGalleriesSideBySideDemoHeight,
    videoGalleriesSideBySideDemoRecording01FirstFrame,
    videoGalleriesSideBySideDemoRecording01JumpCuts,
    videoGalleriesSideBySideDemoRecording01LastFrame,
    videoGalleriesSideBySideDemoWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/030_video_galleries_side_by_side_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {VideoWithJumpCuts} from "~/admin/marketing/2026_04_scalable_demos/helpers/video_with_jump_cuts.js";

export function VideoGalleriesSideBySideDemoComposition() {
    return (
        <div
            style={{
                position: "relative",
                overflow: "hidden",
                width: videoGalleriesSideBySideDemoWidth * 2,
                height: videoGalleriesSideBySideDemoHeight * 2,
            }}
        >
            <VideoWithJumpCuts
                src={remotionFile("030_video_galleries_side_by_side_demo_recording_01.webm")}
                volume={0}
                trimBefore={videoGalleriesSideBySideDemoRecording01FirstFrame}
                trimAfter={videoGalleriesSideBySideDemoRecording01LastFrame}
                trimSections={videoGalleriesSideBySideDemoRecording01JumpCuts}
                objectFit="cover"
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    pointerEvents: "none",
                    zoom: 1.004, // demo size is just a little off our default
                }}
            />
        </div>
    );
}
