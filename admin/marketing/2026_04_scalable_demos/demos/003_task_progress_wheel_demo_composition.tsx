import {Video} from "@remotion/media";
import {Freeze, useCurrentFrame} from "remotion";
import {
    taskProgressWheelDemoRecording01CollapsedChildTasksFrame,
    taskProgressWheelDemoRecording01ExpandedChildTasksFrame,
    taskProgressWheelDemoRecording01FirstFrame,
    taskProgressWheelDemoRecording01FirstFrameFreezePadding,
    taskProgressWheelDemoRecordingHeight,
    taskProgressWheelDemoRecordingMarginY,
    taskProgressWheelDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/003_task_progress_wheel_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {scalableDemoNarrowViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export function TaskProgressWheelDemoComposition() {
    const currentFrame = useCurrentFrame();

    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoNarrowViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_03.jpeg")}
            reactionBottom="-9"
            reactionLeft="2"
            reaction={{character: {type: "Cat", variant: "Yellow"}, emotion: "Yes"}}
        >
            <div
                style={{
                    position: "relative",
                    zIndex: 0,
                    overflow: "hidden",
                    width: taskProgressWheelDemoRecordingWidth * 2,
                    height: taskProgressWheelDemoRecordingHeight * 2,
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        zIndex: 10,
                        backgroundColor: "white",
                        width: 160,
                        height: 40,
                        top: 10,
                        left: 100,
                    }}
                />
                {(currentFrame <
                    taskProgressWheelDemoRecording01ExpandedChildTasksFrame -
                        taskProgressWheelDemoRecording01FirstFrame ||
                    currentFrame >=
                        taskProgressWheelDemoRecording01CollapsedChildTasksFrame -
                            taskProgressWheelDemoRecording01FirstFrame) && (
                    <div
                        style={{
                            position: "absolute",
                            zIndex: 10,
                            backgroundColor: "white",
                            height: 80,
                            bottom: 0,
                            left: 0,
                            right: 0,
                        }}
                    />
                )}
                <Freeze
                    frame={taskProgressWheelDemoRecording01FirstFrameFreezePadding}
                    active={currentFrame < taskProgressWheelDemoRecording01FirstFrameFreezePadding}
                >
                    <Video
                        src={remotionFile("003_task_progress_wheel_demo_recording_01.webm")}
                        volume={0}
                        trimBefore={taskProgressWheelDemoRecording01FirstFrame}
                        style={{
                            position: "absolute",
                            top:
                                -scalableDemoMacOsTopBarAndChromeTopBarHeight * 2 -
                                309 * 2 +
                                taskProgressWheelDemoRecordingMarginY * 2,
                            left:
                                -convertRemLengthToPx(
                                    scalableDemoSpaceSideBarWidth,
                                    scalableDemoNarrowViewportSpacingScale,
                                ) * 2,
                            pointerEvents: "none",
                        }}
                    />
                </Freeze>
            </div>
        </ScalableDemoCompositionLayout>
    );
}
