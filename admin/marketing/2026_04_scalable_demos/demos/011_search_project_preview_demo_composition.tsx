import {
    searchProjectPreviewDemoRecording01FirstFrame,
    searchProjectPreviewDemoRecording01JumpCuts,
    searchProjectPreviewDemoRecording01LastFrame,
} from "~/admin/marketing/2026_04_scalable_demos/demos/011_search_project_preview_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {
    scalableDemoDefaultViewportSpacingScale,
    scalableDemoDefaultViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {VideoWithJumpCuts} from "~/admin/marketing/2026_04_scalable_demos/helpers/video_with_jump_cuts.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function SearchProjectPreviewDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_013.jpeg")}
            reaction={{character: {type: "Cat", variant: "Pink"}, emotion: "Happy"}}
            reactionBottom="-6"
            reactionLeft="7"
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: scalableDemoDefaultViewportWidth * 2,
                    height: Math.round(scalableDemoDefaultViewportWidth / goldenRatio) * 2,
                }}
            >
                <VideoWithJumpCuts
                    src={remotionFile("011_search_project_preview_demo_recording_01.webm")}
                    volume={0}
                    trimBefore={searchProjectPreviewDemoRecording01FirstFrame}
                    trimAfter={searchProjectPreviewDemoRecording01LastFrame}
                    trimSections={searchProjectPreviewDemoRecording01JumpCuts}
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        pointerEvents: "none",
                        zoom: 1.05,
                    }}
                />
            </div>
        </ScalableDemoCompositionLayout>
    );
}
