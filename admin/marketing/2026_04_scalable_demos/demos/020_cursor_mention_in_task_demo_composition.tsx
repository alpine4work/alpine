import {Video} from "@remotion/media";
import {cursorMentionInTaskDemoRecording01FirstFrame} from "~/admin/marketing/2026_04_scalable_demos/demos/020_cursor_mention_in_task_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {
    scalableDemoDefaultViewportSpacingScale,
    scalableDemoDefaultViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function CursorMentionInTaskDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_022.png")}
            reaction={{character: {type: "Cat", variant: "Yellow"}, emotion: "Shock"}}
            reactionBottom="-6"
            reactionLeft="0"
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: scalableDemoDefaultViewportWidth * 2,
                    height: Math.round(scalableDemoDefaultViewportWidth / goldenRatio) * 2,
                }}
            >
                <Video
                    src={remotionFile("020_cursor_mention_in_task_demo_recording_01.webm")}
                    volume={0}
                    trimBefore={cursorMentionInTaskDemoRecording01FirstFrame}
                    style={{
                        position: "absolute",
                        top: -((scalableDemoMacOsTopBarAndChromeTopBarHeight + 10) * 2),
                        left: -50,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionLayout>
    );
}
