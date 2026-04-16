import {Video} from "@remotion/media";
import {
    taskTemplatesDemoRecordingFirstFrame,
    taskTemplatesDemoRecordingHeight,
    taskTemplatesDemoRecordingLastFrame,
    taskTemplatesDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/009_task_templates_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {scalableDemoDefaultViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export function TaskTemplatesDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_009.jpeg")}
            reactionBottom="-6"
            reactionLeft="4"
            reaction={{character: {type: "Frog", variant: "Cyan"}, emotion: "Celebrate"}}
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: taskTemplatesDemoRecordingWidth * 2,
                    height: taskTemplatesDemoRecordingHeight * 2,
                }}
            >
                <Video
                    src={remotionFile("009_task_templates_demo_recording_01.webm")}
                    trimBefore={taskTemplatesDemoRecordingFirstFrame}
                    trimAfter={taskTemplatesDemoRecordingLastFrame}
                    volume={0}
                    style={{
                        position: "absolute",
                        top: -scalableDemoMacOsTopBarAndChromeTopBarHeight * 2,
                        left:
                            -convertRemLengthToPx(
                                scalableDemoSpaceSideBarWidth,
                                scalableDemoDefaultViewportSpacingScale,
                            ) * 2,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionLayout>
    );
}
