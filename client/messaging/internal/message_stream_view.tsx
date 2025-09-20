import classNames from "classnames";
import {MagnifyingGlass} from "phosphor-react";
import {Memo, ReactNode, memo, useEffect, useMemo, useState} from "react";
import {ContentView} from "~/client/content/content_view.js";
import {hasStandaloneMarginByContentBlockNodeTypeName} from "~/client/content/has_standalone_margin_by_content_block_node_type_name.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {contentStyles, pulseAnimationClassName, sprinkles} from "~/client/styles/styles.js";
import {ContentBlockNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {isContentBodyEmpty} from "~/shared/content/is_content_empty.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {
    MessageStream,
    MessageStreamPartPayload,
    MessageStreamToolCallPartPayloadCall,
} from "~/shared/messaging/message_schema.js";

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

// TODO(calebmer, #ai-realtime-hacks): I haven't implemented backfilling
// for message streams. That means a user could load the page when there's an
// active stream and they'll load the current stream parts from the server but
// miss some realtime events that happen between the Remix `loader()` call and
// when we connect to a messaging realtime WebSocket. Or they'll miss realtime
// events if they go temporarily offline.
//
// My proposal for backfill is to initiate backfill in this component. (So we
// only backfill message streams that are rendered.) And pass the list of parts
// plus the parts versions, compare that to what's on the server, and return
// any new parts.
//
// I haven't implemented backfilling since I'm moving fast today to get this
// shipped.
export function MessageStreamView({
    content,
    stream,
    withUserSelectNone,
    getClipboardSerializerPrefix,
}: {
    content: MessageContentWithReferences;
    stream: MessageStream;
    withUserSelectNone: boolean;
    getClipboardSerializerPrefix: Memo<() => string | null>;
}) {
    const spacingScale = useSpacingScale();

    const isContentEmpty = useMemo(() => isContentBodyEmpty(content.doc), [content.doc]);
    const [wasIncompleteWhenMounted] = useState(() => stream.completedTime === null);

    return (
        <div
            style={{
                minHeight: wasIncompleteWhenMounted
                    ? contentStyles.paragraphLineHeightPx[spacingScale] * 8
                    : contentStyles.paragraphLineHeightPx[spacingScale],
            }}
        >
            {!isContentEmpty && (
                <MessageStreamViewContentPart
                    doc={content.doc}
                    references={content.references}
                    withUserSelectNone={withUserSelectNone}
                    getClipboardSerializerPrefix={getClipboardSerializerPrefix}
                />
            )}
            {stream.parts.map((part, index) => {
                let previousBlockNodeTypeName: ContentBlockNodeTypeName | null = null;

                if (index === 0) {
                    if (isContentEmpty) {
                        previousBlockNodeTypeName = null;
                    } else {
                        previousBlockNodeTypeName = content.doc.lastChild!.type
                            .name as ContentBlockNodeTypeName;
                    }
                } else {
                    const previousPart = stream.parts[index - 1]!;

                    // TODO(calebmer, #ai): List items are getting the wrong amount of spacing. We
                    // should have less spacing between each list item.
                    previousBlockNodeTypeName =
                        previousPart.payload.type === "Content"
                            ? (previousPart.payload.content.lastChild!.type
                                  .name as ContentBlockNodeTypeName)
                            : // HACK: Something with standalone margin.
                              "fileRow";
                }

                return (
                    <MessageStreamViewPart
                        key={index}
                        payload={part.payload}
                        references={content.references}
                        withUserSelectNone={withUserSelectNone}
                        getClipboardSerializerPrefix={getClipboardSerializerPrefix}
                        previousBlockNodeTypeName={previousBlockNodeTypeName}
                    />
                );
            })}
            {((isContentEmpty && stream.parts.length === 0) ||
                (stream.parts.length > 0 &&
                    stream.parts[stream.parts.length - 1]!.payload.type !== "Content")) &&
                (() => {
                    let previousBlockNodeTypeName: ContentBlockNodeTypeName | null = null;

                    if (stream.parts.length > 0) {
                        const previousPart = stream.parts[stream.parts.length - 1]!;

                        previousBlockNodeTypeName =
                            previousPart.payload.type === "Content"
                                ? (previousPart.payload.content.lastChild!.type
                                      .name as ContentBlockNodeTypeName)
                                : // HACK: Something with standalone margin.
                                  "fileRow";
                    } else if (!isContentEmpty) {
                        previousBlockNodeTypeName = content.doc.lastChild!.type
                            .name as ContentBlockNodeTypeName;
                    } else {
                        previousBlockNodeTypeName = null;
                    }

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
                })()}
        </div>
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

const MessageStreamViewPart = memo(function MessageStreamViewPart({
    payload,
    references,
    withUserSelectNone,
    getClipboardSerializerPrefix,
    previousBlockNodeTypeName,
}: {
    payload: MessageStreamPartPayload;
    references: ContentReferences;
    withUserSelectNone: boolean;
    getClipboardSerializerPrefix: Memo<() => string | null> | undefined;
    previousBlockNodeTypeName: ContentBlockNodeTypeName | null;
}) {
    let node: ReactNode;

    switch (payload.type) {
        case "ToolCall": {
            node = <MessageStreamViewToolCallPart call={payload.call} />;
            break;
        }
        case "Content": {
            node = (
                <MessageStreamViewContentPart
                    doc={payload.content}
                    references={references}
                    withUserSelectNone={withUserSelectNone}
                    getClipboardSerializerPrefix={getClipboardSerializerPrefix}
                />
            );
            break;
        }
        default:
            throw exhaustive(payload);
    }

    return (
        <>
            {previousBlockNodeTypeName && (
                <div
                    style={{
                        height:
                            hasStandaloneMarginByContentBlockNodeTypeName[
                                payload.type === "Content"
                                    ? payload.content.firstChild!.type.name
                                    : // HACK: Something with standalone margin.
                                      "fileRow"
                            ] ||
                            hasStandaloneMarginByContentBlockNodeTypeName[previousBlockNodeTypeName]
                                ? spacing[contentStyles.standaloneBlockMargin]
                                : spacing[contentStyles.paragraphMargin],
                    }}
                />
            )}
            {node}
        </>
    );
});

function MessageStreamViewToolCallPart({call}: {call: MessageStreamToolCallPartPayloadCall}) {
    const spacingScale = useSpacingScale();

    return (
        <div
            className={sprinkles({
                color: "grey-60",
                fontSize: "100",
                fontStyle: "truncate",
                userSelect: "text",
            })}
            style={{lineHeight: `${contentStyles.paragraphLineHeightPx[spacingScale]}px`}}
        >
            <MagnifyingGlass
                // NOTE(calebmer): Uses the exact same design as "Deleted message"
                // in `<MessageView>`.
                size={spacing["4"]}
                style={{
                    display: "inline",
                    verticalAlign: "top",
                    position: "relative",
                    // Optically align icon with text.
                    top: "0.1875rem",
                }}
            />{" "}
            Reading “<span className={sprinkles({fontStyle: "semi-bold"})}>{call.title}</span>”
        </div>
    );
}

function MessageStreamViewContentPart({
    doc,
    references,
    withUserSelectNone,
    getClipboardSerializerPrefix,
}: {
    doc: MessageContent;
    references: ContentReferences;
    withUserSelectNone: boolean;
    getClipboardSerializerPrefix: Memo<() => string | null> | undefined;
}) {
    return (
        <ContentView
            content={{doc, references}}
            withUserSelectNone={withUserSelectNone}
            getClipboardSerializerPrefix={getClipboardSerializerPrefix}
        />
    );
}
