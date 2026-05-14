import {
    activeTasksInSuggestedDemoFirstFrame,
    activeTasksInSuggestedDemoLastFrame,
    activeTasksInSuggestedDemoRecording01JumpCuts,
} from "~/admin/marketing/2026_04_scalable_demos/demos/017_active_tasks_in_suggested_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionDeprecatedLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_deprecated_layout.js";
import {scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {
    scalableDemoWideViewportSpacingScale,
    scalableDemoWideViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {VideoWithJumpCuts} from "~/admin/marketing/2026_04_scalable_demos/helpers/video_with_jump_cuts.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function ActiveTasksInSuggestedDemoComposition() {
    return (
        <ScalableDemoCompositionDeprecatedLayout
            spacingScale={scalableDemoWideViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_003.jpeg")}
            reaction={{character: {type: "Tulip", variant: "Violet"}, emotion: "Heart"}}
            reactionBottom="-4"
            reactionLeft="0"
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: scalableDemoWideViewportWidth * 2,
                    height: Math.round(scalableDemoWideViewportWidth / goldenRatio) * 2,
                }}
            >
                <VideoWithJumpCuts
                    src={remotionFile("017_active_tasks_in_suggested_demo_recording_01.webm")}
                    volume={0}
                    trimBefore={activeTasksInSuggestedDemoFirstFrame}
                    trimAfter={activeTasksInSuggestedDemoLastFrame}
                    trimSections={activeTasksInSuggestedDemoRecording01JumpCuts}
                    style={{
                        position: "absolute",
                        top: -(scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight * 2) - 23,
                        left: 0,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionDeprecatedLayout>
    );
}
