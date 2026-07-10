import {CaretRight} from "phosphor-react";
import {ReactNode, Ref, useEffect, useMemo, useState} from "react";
import {usePress} from "react-aria";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {MessageStreamViewNonContentPart} from "~/client/web/messaging/internal/message_stream_view_non_content_part.js";
import {MessageStreamSection} from "~/client/web/messaging/internal/message_stream_view_section.js";
import {MessageStreamViewThinkingExpanded} from "~/client/web/messaging/internal/message_stream_view_thinking_expanded.js";
import {MessageStreamViewThinkingProgressDefaultSummary} from "~/client/web/messaging/internal/message_stream_view_thinking_progress_default_summary.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {contentStyles, sprinkles, waveAnimationClassName} from "~/client/web/styles/styles.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// Assign a variable to null so you get a TypeScript error if you try to
// use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

export function MessageStreamViewThinkingSummary({
    content,
    streamCompletedTime,
    section,
    expandedRef,
    isExpanded,
    onToggleIsExpanded,
}: {
    content: MessageContentWithReferences;
    streamCompletedTime: Date | null;
    section: MessageStreamSection;
    expandedRef: Ref<HTMLDivElement | null>;
    isExpanded: boolean;
    onToggleIsExpanded: () => void;
}) {
    const thinkingEndTime = section.contentStartTime ?? streamCompletedTime;

    const nonContentParts = useMemo(() => {
        const nonContentParts: Array<
            Exclude<MessageStreamPartPayload, {type: "Content" | "ExperimentalApprovals"}>
        > = [];

        for (const part of section.nonContentParts) {
            const previousPart = nonContentParts[nonContentParts.length - 1];

            // If the previous part is a `Read` tool call for the same path then combine them
            // into one part. This will happen if the agent is reading multiple pages from an
            // entity.
            if (
                previousPart &&
                part.type === "ToolCall" &&
                previousPart.type === "ToolCall" &&
                part.call.type === "Read" &&
                previousPart.call.type === "Read" &&
                part.call.targetPath === previousPart.call.targetPath
            ) {
                continue;
            }

            nonContentParts.push(part);
        }

        return nonContentParts;
    }, [section.nonContentParts]);

    const {isPressed, pressProps} = usePress({
        isDisabled: nonContentParts.length === 0,
        onPress: onToggleIsExpanded,
    });

    // If this was a content only section, then there was no thinking involved. This
    // may happen when we send "system" messages that let the user know that they've
    // reached or are nearing their agent usage limits.
    if (section.contentParts.length > 0 && nonContentParts.length === 0) return null;

    return (
        <div
            className={sprinkles({
                color: "grey-70",
                fontSize: contentStyles.paragraphActualFontSize,
                paddingBottom:
                    section.contentParts.length > 0 ? contentStyles.paragraphMargin : undefined,
            })}
            style={{
                lineHeight: contentStyles.paragraphLineHeightVar,
                // Very subtle, but we decrease the font weight from the body weight 400 to
                // differentiate the thinking summary from body text.
                fontWeight: 375,
            }}
        >
            <FocusRing offset="0" insetX="-0.5">
                <div
                    {...pressProps}
                    // Ignore press events in mentions. Pressing a mention should open the mention in a
                    // peek not expand the thinking summary.
                    onClick={event => {
                        if (
                            !(event.target instanceof HTMLElement) ||
                            !event.target.closest(`.${contentStyles.mentionContainerClassName}`)
                        ) {
                            pressProps.onClick?.(event);
                        }
                    }}
                    onMouseDown={event => {
                        if (
                            !(event.target instanceof HTMLElement) ||
                            !event.target.closest(`.${contentStyles.mentionContainerClassName}`)
                        ) {
                            pressProps.onMouseDown?.(event);
                        }
                    }}
                    onMouseUp={event => {
                        if (
                            !(event.target instanceof HTMLElement) ||
                            !event.target.closest(`.${contentStyles.mentionContainerClassName}`)
                        ) {
                            pressProps.onMouseUp?.(event);
                        }
                    }}
                    onPointerDown={event => {
                        if (
                            !(event.target instanceof HTMLElement) ||
                            !event.target.closest(`.${contentStyles.mentionContainerClassName}`)
                        ) {
                            pressProps.onPointerDown?.(event);
                        }
                    }}
                    onPointerUp={event => {
                        if (
                            !(event.target instanceof HTMLElement) ||
                            !event.target.closest(`.${contentStyles.mentionContainerClassName}`)
                        ) {
                            pressProps.onPointerUp?.(event);
                        }
                    }}
                    tabIndex={nonContentParts.length > 0 ? 0 : undefined}
                    className={sprinkles({
                        maxWidth: "full",
                        // This must be `inline-flex` so only the text is clickable instead of the full
                        // block width.
                        display: "inline-flex",
                        alignItems: "center",
                        cursor: nonContentParts.length > 0 ? "pointer" : undefined,
                        opacity: isPressed ? "60" : undefined,
                    })}
                >
                    <div
                        className={sprinkles({
                            // This must be `inline-block` so only the text is clickable.
                            display: "inline-block",
                            minWidth: "flex-fit",
                            maxWidth: "full",
                            fontStyle: "truncate",
                        })}
                    >
                        {thinkingEndTime ? (
                            <MessageStreamSectionThinkingCompletedSummary
                                thinkingStartTime={section.startTime}
                                thinkingEndTime={thinkingEndTime}
                            />
                        ) : (
                            <MessageStreamSectionThinkingProgressSummary
                                references={content.references}
                                nonContentParts={nonContentParts}
                            />
                        )}
                    </div>
                    {nonContentParts.length > 0 && (
                        <>
                            <div
                                className={sprinkles({
                                    flexShrink: "0",
                                    fontSize: contentStyles.paragraphActualFontSize,
                                })}
                            >
                                &nbsp;
                            </div>
                            <CaretRight
                                size={spacing["3"]}
                                weight="bold"
                                className={sprinkles({flexShrink: "0"})}
                                style={{
                                    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                    transition: "transform 250ms ease",
                                }}
                            />
                        </>
                    )}
                </div>
            </FocusRing>
            {isExpanded && (
                <MessageStreamViewThinkingExpanded
                    ref={expandedRef}
                    nonContentParts={nonContentParts}
                    content={content}
                    thinkingEndTime={thinkingEndTime}
                />
            )}
        </div>
    );
}

function MessageStreamSectionThinkingCompletedSummary({
    thinkingStartTime,
    thinkingEndTime,
}: {
    thinkingStartTime: Date;
    thinkingEndTime: Date;
}) {
    const {locale} = useClientInfo();

    const durationString = useMemo(() => {
        const durationMilliseconds = thinkingEndTime.getTime() - thinkingStartTime.getTime();

        const durationSeconds = Math.floor(durationMilliseconds / 1000);
        const durationMinutes = Math.floor(durationSeconds / 60);
        const durationRemainingSeconds = durationSeconds - durationMinutes * 60;

        if (durationMinutes > 0) {
            const durationMinutesString = printPrettyNumber(locale, durationMinutes, "minute");

            if (durationRemainingSeconds > 0) {
                const durationRemainingSecondsString = printPrettyNumber(
                    locale,
                    durationRemainingSeconds,
                    "second",
                );

                return `${durationMinutesString} and ${durationRemainingSecondsString}`;
            } else {
                return durationMinutesString;
            }
        }

        return printPrettyNumber(locale, durationRemainingSeconds, "second");
    }, [locale, thinkingEndTime, thinkingStartTime]);

    return <>Thought for {durationString}</>;
}

function MessageStreamSectionThinkingProgressSummary({
    references,
    nonContentParts,
}: {
    references: ContentReferences;
    nonContentParts: ReadonlyArray<
        Exclude<MessageStreamPartPayload, {type: "Content" | "ExperimentalApprovals"}>
    >;
}) {
    const [actualProgress, setProgress] = useState<{index: number; displayTime: number} | null>(
        null,
    );
    let progress = actualProgress;

    // Make sure `progress.index` is in bounds of `nonContentParts`.
    if (progress !== null) {
        if (nonContentParts.length === 0) {
            progress = null;
            setProgress(progress);
        } else if (progress.index >= nonContentParts.length) {
            progress = {index: nonContentParts.length - 1, displayTime: Date.now()};
            setProgress(progress);
        }
    }

    useEffect(() => {
        if (nonContentParts.length === 0) return;

        if (progress === null) {
            setProgress({
                index: nonContentParts.length - 1,
                displayTime: Date.now(),
            });
            return;
        }

        // We increment `progress.index` until it's the last non-content part.
        if (!(progress.index < nonContentParts.length - 1)) return;

        // Always display each non-content part for at least 1 second so the user has a
        // chance to read it.
        const minNonContentPartVisibleDurableMs = 1000;

        const delayMs = progress.displayTime + minNonContentPartVisibleDurableMs - Date.now();

        const run = () => {
            // Increment by one. If the next part isn't the latest we'll set another timeout
            // that increments us again.
            setProgress({
                index: progress.index + 1,
                displayTime: Date.now(),
            });
        };

        if (delayMs <= 0) {
            run();
            return;
        }

        const timeout = createTimeout(run, delayMs);
        return () => {
            timeout.clear();
        };
    }, [nonContentParts, progress]);

    let node: ReactNode;

    if (progress === null) {
        node = <MessageStreamViewThinkingProgressDefaultSummary />;
    } else {
        node = (
            <MessageStreamViewNonContentPart
                references={references}
                part={nonContentParts[progress.index]!}
            />
        );
    }

    return (
        <span
            // Remount (and reset the wave animation) whenever we show a new non-content part.
            key={progress?.index}
            className={waveAnimationClassName}
        >
            {node}
        </span>
    );
}
