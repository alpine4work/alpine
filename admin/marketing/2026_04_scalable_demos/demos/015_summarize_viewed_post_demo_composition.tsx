import {
    summarizeViewedPostDemoRecordingFirstFrame,
    summarizeViewedPostDemoRecordingJumpCuts,
    summarizeViewedPostDemoRecordingLastFrame,
} from "~/admin/marketing/2026_04_scalable_demos/demos/015_summarize_viewed_post_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {
    scalableDemoDefaultViewport,
    scalableDemoDefaultViewportSpacingScale,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {VideoWithJumpCuts} from "~/admin/marketing/2026_04_scalable_demos/helpers/video_with_jump_cuts.js";

export function SummarizeViewedPostDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_009.jpeg")}
            reaction={{character: {type: "Frog", variant: "Yellow"}, emotion: "ThankYou"}}
            reactionBottom="-4"
            reactionLeft="12"
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: scalableDemoDefaultViewport.width * 2,
                    height: scalableDemoDefaultViewport.height * 2,
                }}
            >
                <VideoWithJumpCuts
                    src={remotionFile("15_summarize_viewed_post_demo_recording_01.webm")}
                    volume={0}
                    trimBefore={summarizeViewedPostDemoRecordingFirstFrame}
                    trimAfter={summarizeViewedPostDemoRecordingLastFrame}
                    trimSections={summarizeViewedPostDemoRecordingJumpCuts}
                    style={{
                        position: "absolute",
                        top: -(scalableDemoMacOsTopBarAndChromeTopBarHeight * 2) - 23,
                        left: 0,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionLayout>
    );
}
