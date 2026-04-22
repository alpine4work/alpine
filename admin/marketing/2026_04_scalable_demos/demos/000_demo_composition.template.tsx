import {Video} from "@remotion/media";
// @ts-expect-error — template placeholder path
import {__demoName__DemoRecording01FirstFrame} from "~/admin/marketing/2026_04_scalable_demos/demos/__DEMO_NUMBER_____DEMO_NAME___demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {
    scalableDemoDefaultViewportSpacingScale,
    scalableDemoDefaultViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function __DemoName__DemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_01.jpeg")}
            reaction={{character: {type: "Yeti", variant: "Blue"}, emotion: "Celebrate"}}
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
                <Video
                    src={remotionFile("__DEMO_NUMBER_____DEMO_NAME___demo_recording_01.webm")}
                    volume={0}
                    trimBefore={__demoName__DemoRecording01FirstFrame}
                    style={{
                        position: "absolute",
                        top: -(scalableDemoMacOsTopBarAndChromeTopBarHeight * 2),
                        left: 0,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionLayout>
    );
}
