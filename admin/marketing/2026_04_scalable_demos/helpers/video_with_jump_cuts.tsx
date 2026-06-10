import {Video} from "@remotion/media";
import {ComponentProps} from "react";
import {Series} from "remotion";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";

export function VideoWithJumpCuts(
    props: Omit<ComponentProps<typeof Video>, "trimBefore" | "trimAfter"> & {
        trimBefore: number;
        trimAfter: number;
        trimSections: Array<{startFrame: number; endFrame: number}>;
    },
) {
    const sections: Array<{trimBefore: number; trimAfter: number}> = [];

    let nextTrimBefore = props.trimBefore;

    for (const {startFrame, endFrame} of props.trimSections) {
        sections.push({trimBefore: nextTrimBefore, trimAfter: startFrame});
        nextTrimBefore = endFrame + 1;
    }

    sections.push({
        trimBefore: nextTrimBefore,
        trimAfter: props.trimAfter,
    });

    return (
        <Series>
            {sections.map(({trimBefore, trimAfter}, index) => (
                <Series.Sequence
                    key={index}
                    durationInFrames={trimAfter - trimBefore}
                    premountFor={scalableDemoFps}
                >
                    <Video {...props} trimBefore={trimBefore} trimAfter={trimAfter} />
                </Series.Sequence>
            ))}
        </Series>
    );
}
