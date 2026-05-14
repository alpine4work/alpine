import {ReactNode} from "react";
import {AbsoluteFill, Img, useVideoConfig} from "remotion";
import {computeScalableDemoCompositionDeprecatedMargin} from "~/admin/marketing/2026_04_scalable_demos/helpers/compute_scalable_demo_composition_deprecated_margin.js";
import {scalableDemoDefaultViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {ReactionIcon} from "~/client/web/reactions/icons/reaction_icon.js";
import {ParsableRemLength, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {LogoWordmarkBase} from "~/shared/design/logo_wordmark_base.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";
import {Reaction} from "~/shared/reactions/reaction.js";

/** @deprecated */
export function ScalableDemoCompositionDeprecatedLayout({
    spacingScale,
    backgroundImageSrc,
    withoutCardBackgroundColor,
    reactionTop,
    reactionBottom,
    reactionLeft,
    reactionRight,
    reaction,
    logoColor = "white",
    children,
}: {
    spacingScale: SpacingScale;
    backgroundImageSrc: string;
    withoutCardBackgroundColor?: boolean;
    reactionTop?: ParsableRemLength | number;
    reactionBottom?: ParsableRemLength | number;
    reactionLeft?: ParsableRemLength | number;
    reactionRight?: ParsableRemLength | number;
    reaction: Reaction;
    logoColor?: "white" | "black";
    children?: ReactNode;
}) {
    const {width: actualWidth} = useVideoConfig();

    // What is the width we designed `<ScalableDemoCompositionLayout>` for? If the
    // width ends up being much larger than expected (e.g. because we use
    // `scalableDemoDefaultViewport` instead of `scalableDemoNarrowViewportWidth`) then
    // we need to scale up all our elements.
    const expectedWidth = Math.round(
        (scalableDemoDefaultViewportWidth +
            computeScalableDemoCompositionDeprecatedMargin(
                scalableDemoDefaultViewportWidth,
                Math.round(scalableDemoDefaultViewportWidth / goldenRatio),
            ) *
                2) *
            2,
    );

    const scale = actualWidth / expectedWidth;

    const reactionSize = "16";

    return (
        <AbsoluteFill style={{justifyContent: "center", alignItems: "center"}}>
            <AbsoluteFill>
                <Img
                    src={backgroundImageSrc}
                    style={{display: "block", width: "100%", height: "100%", objectFit: "cover"}}
                />
            </AbsoluteFill>
            <div
                style={{
                    position: "absolute",
                    right: convertRemLengthToPx("3", spacingScale) * 2 * scale,
                    bottom: convertRemLengthToPx("2", spacingScale) * 2 * scale,
                    zIndex: 20,
                    opacity: 0.4,
                }}
            >
                <LogoWordmarkBase
                    size={convertRemLengthToPx("24", spacingScale) * 2 * scale}
                    color={logoColor}
                />
            </div>
            <div
                style={{
                    position: "relative",
                    zIndex: 0,
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        zIndex: 20,
                        width: convertRemLengthToPx(reactionSize, spacingScale) * 2 * scale,
                        height: convertRemLengthToPx(reactionSize, spacingScale) * 2 * scale,
                        top:
                            typeof reactionTop === "string"
                                ? convertRemLengthToPx(reactionTop, spacingScale) * 2 * scale
                                : reactionTop !== undefined
                                  ? reactionTop * scale
                                  : undefined,
                        bottom:
                            typeof reactionBottom === "string"
                                ? convertRemLengthToPx(reactionBottom, spacingScale) * 2 * scale
                                : reactionBottom !== undefined
                                  ? reactionBottom * scale
                                  : undefined,
                        left:
                            typeof reactionLeft === "string"
                                ? convertRemLengthToPx(reactionLeft, spacingScale) * 2 * scale
                                : reactionLeft !== undefined
                                  ? reactionLeft * scale
                                  : undefined,
                        right:
                            typeof reactionRight === "string"
                                ? convertRemLengthToPx(reactionRight, spacingScale) * 2 * scale
                                : reactionRight !== undefined
                                  ? reactionRight * scale
                                  : undefined,
                    }}
                >
                    <ReactionIcon
                        imgComponent={Img}
                        reaction={reaction}
                        size={convertRemLengthToPx(reactionSize, spacingScale) * 2 * scale}
                    />
                </div>
                <div
                    style={{
                        position: "relative",
                        zIndex: 10,
                        overflow: "hidden",
                        backgroundColor: withoutCardBackgroundColor ? "transparent" : "white",
                        borderRadius: convertRemLengthToPx("6", spacingScale) * 2 * scale,

                        // Available in new versions of Chrome. Which is good enough for us since we render
                        // our videos using Chrome!
                        //
                        // https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/corner-shape-value
                        //
                        // @ts-expect-error
                        cornerShape: "squircle",

                        // This shadow was derived from `elevation-60` in `elevation.css.ts`. All pixel
                        // values are doubled to account for the device pixel ratio.
                        boxShadow: `0 0 0 ${2 * scale}px rgb(0 0 0 / 0.09), 0 ${64 * scale}px ${128 * scale}px -${24 * scale}px rgb(18 18 20 / 0.15)`,
                    }}
                >
                    {children}
                </div>
            </div>
        </AbsoluteFill>
    );
}
