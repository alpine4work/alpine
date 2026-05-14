import {
    dragToSetTaskDueDateDemoRecording01FirstFrame,
    dragToSetTaskDueDateDemoRecording01JumpCuts,
    dragToSetTaskDueDateDemoRecording01LastFrame,
} from "~/admin/marketing/2026_04_scalable_demos/demos/018_drag_to_set_task_due_date_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionDeprecatedLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_deprecated_layout.js";
import {scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {
    scalableDemoWideViewport,
    scalableDemoWideViewportSpacingScale,
    scalableDemoWideViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {VideoWithJumpCuts} from "~/admin/marketing/2026_04_scalable_demos/helpers/video_with_jump_cuts.js";

export function DragToSetTaskDueDateDemoComposition() {
    return (
        <ScalableDemoCompositionDeprecatedLayout
            spacingScale={scalableDemoWideViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_009.jpeg")}
            reaction={{character: {type: "Cat", variant: "Yellow"}, emotion: "ThankYou"}}
            reactionBottom="-5"
            reactionLeft="8"
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: scalableDemoWideViewportWidth * 2,
                    height: scalableDemoWideViewport.height * 2,
                }}
            >
                <VideoWithJumpCuts
                    src={remotionFile("018_drag_to_set_task_due_date_demo_recording_02.webm")}
                    volume={0}
                    trimBefore={dragToSetTaskDueDateDemoRecording01FirstFrame}
                    trimAfter={dragToSetTaskDueDateDemoRecording01LastFrame}
                    trimSections={dragToSetTaskDueDateDemoRecording01JumpCuts}
                    style={{
                        position: "absolute",
                        top: -(scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight * 2) - 23,
                        left: -64,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionDeprecatedLayout>
    );
}
