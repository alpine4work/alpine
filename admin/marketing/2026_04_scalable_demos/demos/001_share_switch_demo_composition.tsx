import {Video} from "@remotion/media";
import {shareSwitchDemoRecording01FirstFrame} from "~/admin/marketing/2026_04_scalable_demos/demos/001_share_switch_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionDeprecatedLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_deprecated_layout.js";
import {scalableDemoDefaultViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {scalableDemoWideViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function ShareSwitchDemoComposition() {
    return (
        <ScalableDemoCompositionDeprecatedLayout
            spacingScale={scalableDemoWideViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_001.jpeg")}
            reactionBottom="-12"
            reactionLeft="5"
            reaction={{character: {type: "Tree", variant: "Green"}, emotion: "Shock"}}
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
                    src={remotionFile("001_share_switch_demo_recording_01.webm")}
                    volume={0}
                    trimBefore={shareSwitchDemoRecording01FirstFrame}
                    style={{
                        position: "absolute",
                        top: -(scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight * 2),
                        left: 0,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionDeprecatedLayout>
    );
}
