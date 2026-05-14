import {Video} from "@remotion/media";
import {codeBlockEditorKeyboardShortcutsDemoRecording01FirstFrame} from "~/admin/marketing/2026_04_scalable_demos/demos/026_code_block_editor_keyboard_shortcuts_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {scalableDemoDefaultViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";

export function CodeBlockEditorKeyboardShortcutsDemoComposition() {
    return (
        <div
            style={{
                position: "relative",
                overflow: "hidden",
                width: scalableDemoDefaultViewport.width * 2,
                height: scalableDemoDefaultViewport.height * 2,
            }}
        >
            <Video
                src={remotionFile(
                    "026_code_block_editor_keyboard_shortcuts_demo_recording_01.webm",
                )}
                volume={0}
                trimBefore={codeBlockEditorKeyboardShortcutsDemoRecording01FirstFrame}
                style={{
                    position: "absolute",
                    top: -(scalableDemoMacOsTopBarAndChromeTopBarHeight * 2),
                    left: 0,
                    pointerEvents: "none",
                }}
            />
        </div>
    );
}
