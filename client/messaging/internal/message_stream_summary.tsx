import classNames from "classnames";
import {CaretDown, CaretRight} from "phosphor-react";
import {useEffect, useMemo, useState} from "react";
import {hasStandaloneMarginByContentBlockNodeTypeName} from "~/client/content/has_standalone_margin_by_content_block_node_type_name.js";
import {createMessageStreamSummarySections} from "~/client/messaging/internal/create_message_stream_summary_sections.js";
import {MessageStreamSummarySection} from "~/client/messaging/internal/message_stream_summary_section.js";
import {printAgentThoughtDuration} from "~/client/messaging/internal/print_agent_thought_duration.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {contentStyles, pulseAnimationClassName, sprinkles} from "~/client/styles/styles.js";
import {ContentBlockNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {
    MessageStreamReasoningPartPayload,
    MessageStreamToolCallPartPayload,
} from "~/shared/messaging/message_schema.js";

// NOTE(ifitzsimmons): You are not allowed to use the `<Box>` component in this
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

/**
 * Renders a collapsible "Thinking" section for an agent message. Thinking summaries
 * are grouped by the action type (Reading, Searching, Reasoning). Action groups
 * can also be active / complete.
 *
 * So a thinking summary could look like
 * > Thinking....
 *
 *   Searching (complete)
 *    - search 1
 *    - search 2
 *   Reading (complete)
 *    - reading 1
 *    - reading 2
 *   Reasoning (active)
 *    - reasoning 1
 *    - reasoning 2
 *    ...
 *
 * In the above example, the "Reasoning" section is active and will be displayed with
 * the `pulseAnimationClassName`.
 *
 * Further, a single Agent response could theoretically have multiple "Thinking" sections.
 * For example, if the agent is reading content and then searching for information, it could
 * look like:
 *
 * ```
 * > Thought for 2 minutes
 *
 * Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt
 * ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
 * laboris nisi ut aliquip ex ea commodo consequat.
 *
 * > Thinking....
 *```

 In the above example, the agent did some amount of thinking, it then streamed some "Content"
 and is currently doing some more thinking before completing its response.
 */
export function MessageStreamSummary({
    message: {createdTime: messageCreatedTime},
    streamParts,
    isThinkingSummaryComplete,
    previousBlockNodeTypeName,
    references,
}: {
    message: MessageModel<string> | OptimisticMessageModel;
    streamParts: Array<{
        payload: MessageStreamToolCallPartPayload | MessageStreamReasoningPartPayload;
        createdTime: Date;
    }>;
    isThinkingSummaryComplete: boolean;
    previousBlockNodeTypeName: ContentBlockNodeTypeName | null;
    references: ContentReferences;
}) {
    const spacingScale = useSpacingScale();
    const [isSectionExpanded, setIsSectionExpanded] = useState(false);

    // Collect and group consecutive tool calls by type
    const sections = useMemo(
        () =>
            createMessageStreamSummarySections({
                streamParts,
                messageCreatedTime,
                isThinkingSummaryComplete,
            }),
        [streamParts, messageCreatedTime, isThinkingSummaryComplete],
    );

    if (streamParts.length === 0) {
        return renderThinkingIndicator({previousBlockNodeTypeName});
    }

    const totalThinkingDurationMs =
        streamParts[streamParts.length - 1]!.createdTime.getTime() - messageCreatedTime.getTime();

    return (
        <>
            {previousBlockNodeTypeName && (
                <div
                    style={{
                        height:
                            hasStandaloneMarginByContentBlockNodeTypeName[
                                // HACK: Something with standalone margin.
                                "fileRow"
                            ] ||
                            hasStandaloneMarginByContentBlockNodeTypeName[previousBlockNodeTypeName]
                                ? spacing[contentStyles.standaloneBlockMargin]
                                : spacing[contentStyles.paragraphMargin],
                    }}
                />
            )}
            <div
                className={sprinkles({
                    color: "grey-70",
                    userSelect: "none",
                    fontSize: "100",
                })}
                style={{
                    lineHeight: `${contentStyles.paragraphLineHeightPx[spacingScale]}px`,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: spacing["1"],
                }}
                onClick={() => setIsSectionExpanded(!isSectionExpanded)}
            >
                {isSectionExpanded ? <CaretDown size={16} /> : <CaretRight size={16} />}
                {isThinkingSummaryComplete
                    ? `Thought for ${printAgentThoughtDuration(totalThinkingDurationMs)}`
                    : renderThinkingIndicator({previousBlockNodeTypeName})}
            </div>
            {isSectionExpanded && (
                <div
                    className={sprinkles({
                        paddingTop: "4",
                        paddingBottom: "2",
                        width: "4/5",
                    })}
                >
                    {sections.map((section, sectionIndex) => (
                        <MessageStreamSummarySection
                            key={sectionIndex}
                            section={section}
                            references={references}
                            spacingScale={spacingScale}
                        />
                    ))}
                </div>
            )}
        </>
    );
}

function renderThinkingIndicator({
    previousBlockNodeTypeName,
}: {
    previousBlockNodeTypeName: ContentBlockNodeTypeName | null;
}) {
    return (
        <>
            {previousBlockNodeTypeName && (
                <div
                    style={{
                        height: hasStandaloneMarginByContentBlockNodeTypeName[
                            previousBlockNodeTypeName
                        ]
                            ? spacing[contentStyles.standaloneBlockMargin]
                            : spacing[contentStyles.paragraphMargin],
                    }}
                />
            )}
            <MessageStreamViewThinkingIndicator />
        </>
    );
}

const messageStreamViewThinkingIndicatorAlternativeVerbs = [
    "Reasoning",
    "Writing",
    "Crafting",
    "Generating",
    "Composing",
    "Preparing",
    "Considering",
    "Deliberating",
    "Working",
];

function MessageStreamViewThinkingIndicator() {
    const spacingScale = useSpacingScale();

    const [state, setState] = useState(() => ({
        iteration: 0,
        verb: "Thinking",
        previousVerbs: new Set<string>(),
        lastChangeTime: new Date(),
    }));

    useEffect(() => {
        const changeIntervalMs = 400;

        const timeout = createTimeout(() => {
            setState(state => {
                state = {
                    ...state,
                    iteration: state.iteration + 1,
                    lastChangeTime: new Date(),
                };

                // Switch verbs every 3 dot loops and switch when we're on 3 dots.
                if (state.iteration % 12 === 0) {
                    let possibleVerbs = messageStreamViewThinkingIndicatorAlternativeVerbs.filter(
                        verb => !state.previousVerbs.has(verb),
                    );

                    // We've used all the verbs! Start over.
                    if (possibleVerbs.length === 0) {
                        possibleVerbs = messageStreamViewThinkingIndicatorAlternativeVerbs;

                        state = {
                            ...state,
                            previousVerbs: new Set(),
                        };
                    }

                    const nextVerb = possibleVerbs[randomInteger(0, possibleVerbs.length)]!;

                    state = {
                        ...state,
                        verb: nextVerb,
                        previousVerbs: new Set([...state.previousVerbs, nextVerb]),
                    };
                }

                return state;
            });
        }, state.lastChangeTime.getTime() + changeIntervalMs - Date.now());

        return () => {
            timeout.clear();
        };
    }, [state.lastChangeTime]);

    return (
        <div
            className={classNames(
                pulseAnimationClassName,
                sprinkles({color: "grey-50", fontSize: "100"}),
            )}
            style={{lineHeight: `${contentStyles.paragraphLineHeightPx[spacingScale]}px`}}
        >
            {state.verb}
            {".".repeat(state.iteration % 4)}
        </div>
    );
}
