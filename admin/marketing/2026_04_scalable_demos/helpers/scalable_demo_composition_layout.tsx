import {ReactNode} from "react";
import {AbsoluteFill, Img} from "remotion";
import {ReactionIcon} from "~/client/web/reactions/icons/reaction_icon.js";
import {ParsableRemLength, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {LogoWordmarkBase} from "~/shared/design/logo_wordmark_base.js";
import {Reaction} from "~/shared/reactions/reaction.js";

export function ScalableDemoCompositionLayout({
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
                    right: convertRemLengthToPx("3", spacingScale) * 2,
                    bottom: convertRemLengthToPx("2", spacingScale) * 2,
                    zIndex: 20,
                    opacity: 0.4,
                }}
            >
                <LogoWordmarkBase
                    size={convertRemLengthToPx("48", spacingScale)}
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
                        width: convertRemLengthToPx(reactionSize, spacingScale) * 2,
                        height: convertRemLengthToPx(reactionSize, spacingScale) * 2,
                        top:
                            typeof reactionTop === "string"
                                ? convertRemLengthToPx(reactionTop, spacingScale) * 2
                                : reactionTop,
                        bottom:
                            typeof reactionBottom === "string"
                                ? convertRemLengthToPx(reactionBottom, spacingScale) * 2
                                : reactionBottom,
                        left:
                            typeof reactionLeft === "string"
                                ? convertRemLengthToPx(reactionLeft, spacingScale) * 2
                                : reactionLeft,
                        right:
                            typeof reactionRight === "string"
                                ? convertRemLengthToPx(reactionRight, spacingScale) * 2
                                : reactionRight,
                    }}
                >
                    <div style={{transform: "scale(2)", transformOrigin: "top left"}}>
                        <ReactionIcon
                            imgComponent={Img}
                            reaction={reaction}
                            size={convertRemLengthToPx(reactionSize, spacingScale)}
                        />
                    </div>
                </div>
                <div
                    style={{
                        position: "relative",
                        zIndex: 10,
                        overflow: "hidden",
                        backgroundColor: withoutCardBackgroundColor ? "transparent" : "white",
                        borderRadius: convertRemLengthToPx("6", spacingScale) * 2,

                        // Available in new versions of Chrome. Which is good enough for us since we render
                        // our videos using Chrome!
                        //
                        // https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/corner-shape-value
                        //
                        // @ts-expect-error
                        cornerShape: "squircle",

                        // This shadow was derived from `elevation-60` in `elevation.css.ts`. All pixel
                        // values are doubled to account for the device pixel ratio.
                        boxShadow: `0 0 0 2px rgb(0 0 0 / 0.09), 0px 64px 128px -24px rgb(18 18 20 / 0.15)`,
                    }}
                >
                    {children}
                </div>
            </div>
        </AbsoluteFill>
    );
}
