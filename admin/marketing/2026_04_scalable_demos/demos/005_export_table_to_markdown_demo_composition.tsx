import {Video} from "@remotion/media";
import {
    exportTableToMarkdownDemoRecording01FirstFrame,
    exportTableToMarkdownDemoRecordingHeight,
    exportTableToMarkdownDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/005_export_table_to_markdown_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {scalableDemoDefaultViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";

export function ExportTableToMarkdownDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_05.jpeg")}
            // The card background color is adding some noticeable artifacts when the grey
            // modal overlay is visible.
            withoutCardBackgroundColor={true}
            reactionBottom="-5"
            reactionLeft="7"
            reaction={{character: {type: "Tree", variant: "Blue"}, emotion: "Celebrate"}}
            logoColor="black"
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: exportTableToMarkdownDemoRecordingWidth * 2,
                    height: exportTableToMarkdownDemoRecordingHeight * 2,
                }}
            >
                <Video
                    src={remotionFile("005_export_table_to_markdown_demo_recording_01.webm")}
                    volume={0}
                    trimBefore={exportTableToMarkdownDemoRecording01FirstFrame}
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
