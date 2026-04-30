import {
    myTasksOverviewDemoRecording01FirstFrame,
    myTasksOverviewDemoRecording01JumpCuts,
    myTasksOverviewDemoRecording01LastFrame,
} from "~/admin/marketing/2026_04_scalable_demos/demos/016_my_tasks_overview_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {
    scalableDemoDefaultViewport,
    scalableDemoDefaultViewportSpacingScale,
    scalableDemoDefaultViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {VideoWithJumpCuts} from "~/admin/marketing/2026_04_scalable_demos/helpers/video_with_jump_cuts.js";

export function MyTasksOverviewDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_01.jpeg")}
            reaction={{character: {type: "Tree", variant: "Blue"}, emotion: "Celebrate"}}
            reactionBottom="-8"
            reactionLeft="2"
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: scalableDemoDefaultViewportWidth * 2,
                    height: scalableDemoDefaultViewport.height * 2,
                }}
            >
                <VideoWithJumpCuts
                    src={remotionFile("016_my_tasks_overview_demo_recording_01.webm")}
                    volume={0}
                    trimBefore={myTasksOverviewDemoRecording01FirstFrame}
                    trimAfter={myTasksOverviewDemoRecording01LastFrame}
                    trimSections={myTasksOverviewDemoRecording01JumpCuts}
                    style={{
                        position: "absolute",
                        top: -(scalableDemoMacOsTopBarAndChromeTopBarHeight * 2) - 23,
                        left: -64,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionLayout>
    );
}
