import classNames from "classnames";
import {MagnifyingGlass} from "phosphor-react";
import {Memo, ReactNode, memo, useEffect, useMemo, useState} from "react";
import {ContentView} from "~/client/content/content_view.js";
import {hasStandaloneMarginByContentBlockNodeTypeName} from "~/client/content/has_standalone_margin_by_content_block_node_type_name.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {
    contentStyles,
    messagingStyles,
    pulseAnimationClassName,
    sprinkles,
} from "~/client/styles/styles.js";
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
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
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
    message,
    content,
    stream,
    withUserSelectNone,
    getClipboardSerializerPrefix,
    jumpAnimation,
}: {
    message: MessageModel<string> | OptimisticMessageModel;
    content: MessageContentWithReferences;
    stream: MessageStream;
    withUserSelectNone: boolean;
    getClipboardSerializerPrefix: Memo<() => string | null>;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
}) {
    const spacingScale = useSpacingScale();

    const isContentEmpty = useMemo(() => isContentBodyEmpty(content.doc), [content.doc]);
    const [wasIncompleteWhenMounted] = useState(() => stream.completedTime === null);

    let posAttributeOffset = 0;

    const children: Array<ReactNode> = [];

    if (!isContentEmpty) {
        children.push(
            <MessageStreamViewContentPart
                key="content"
                message={message}
                doc={content.doc}
                references={content.references}
                posAttributeOffset={posAttributeOffset}
                withUserSelectNone={withUserSelectNone}
                getClipboardSerializerPrefix={getClipboardSerializerPrefix}
                jumpAnimation={jumpAnimation}
            />,
        );

        posAttributeOffset += content.doc.content.size;
    }

    for (let index = 0; index < stream.parts.length; index++) {
        const part = stream.parts[index]!;

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

        children.push(
            <MessageStreamViewPart
                key={index}
                message={message}
                payload={part.payload}
                references={content.references}
                posAttributeOffset={posAttributeOffset}
                withUserSelectNone={withUserSelectNone}
                getClipboardSerializerPrefix={
                    isContentEmpty && index === 0 ? getClipboardSerializerPrefix : undefined
                }
                previousBlockNodeTypeName={previousBlockNodeTypeName}
                jumpAnimation={jumpAnimation}
            />,
        );

        if (part.payload.type === "Content") {
            posAttributeOffset += part.payload.content.content.size;
        }
    }

    return (
        <div
            style={{
                minHeight: wasIncompleteWhenMounted
                    ? contentStyles.paragraphLineHeightPx[spacingScale] * 8
                    : contentStyles.paragraphLineHeightPx[spacingScale],
            }}
        >
            {children}
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
    message,
    payload,
    references,
    posAttributeOffset,
    withUserSelectNone,
    getClipboardSerializerPrefix,
    previousBlockNodeTypeName,
    jumpAnimation,
}: {
    message: MessageModel<string> | OptimisticMessageModel;
    payload: MessageStreamPartPayload;
    references: ContentReferences;
    posAttributeOffset: number;
    withUserSelectNone: boolean;
    getClipboardSerializerPrefix: Memo<() => string | null> | undefined;
    previousBlockNodeTypeName: ContentBlockNodeTypeName | null;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
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
                    message={message}
                    doc={payload.content}
                    references={references}
                    posAttributeOffset={posAttributeOffset}
                    withUserSelectNone={withUserSelectNone}
                    getClipboardSerializerPrefix={getClipboardSerializerPrefix}
                    jumpAnimation={jumpAnimation}
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
            {getToolCallLabel(call)}
        </div>
    );
}

function getToolCallLabel(call: MessageStreamToolCallPartPayloadCall) {
    switch (call.type) {
        case "Read": {
            return (
                <>
                    Reading “
                    <span className={sprinkles({fontStyle: "semi-bold"})}>{call.title}</span>”
                </>
            );
        }
        case "Search": {
            return (
                <>
                    Searching “
                    <span className={sprinkles({fontStyle: "semi-bold"})}>{call.query}</span>”
                </>
            );
        }
        default:
            throw exhaustive(call);
    }
}

function MessageStreamViewContentPart({
    message,
    doc,
    references,
    posAttributeOffset,
    withUserSelectNone,
    getClipboardSerializerPrefix,
    jumpAnimation: originalJumpAnimation,
}: {
    message: MessageModel<string> | OptimisticMessageModel;
    doc: MessageContent;
    references: ContentReferences;
    posAttributeOffset: number;
    withUserSelectNone: boolean;
    getClipboardSerializerPrefix: Memo<() => string | null> | undefined;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
}) {
    const jumpAnimation = useMemo(() => {
        if (originalJumpAnimation === null) return null;

        const jumpAnimation = {
            from:
                originalJumpAnimation.from !== null
                    ? Math.max(0, originalJumpAnimation.from - posAttributeOffset)
                    : null,
            to:
                originalJumpAnimation.to !== null
                    ? Math.min(doc.content.size, originalJumpAnimation.to - posAttributeOffset)
                    : null,
            startTime: originalJumpAnimation.startTime,
        };

        // If after offsetting, the jump animation doesn't make sense then we don't
        // have a jump animation for this part.
        if (jumpAnimation.from !== null && jumpAnimation.from > doc.content.size) return null;
        if (jumpAnimation.to !== null && jumpAnimation.to < 0) return null;

        return jumpAnimation;
    }, [doc.content.size, originalJumpAnimation, posAttributeOffset]);

    return (
        <ContentView
            className={messagingStyles.withPointerToolbarClassName}
            data-room={!message.isOptimistic ? message.getRoomKey() : undefined}
            data-index={!message.isOptimistic ? message.index : undefined}
            content={{doc, references}}
            posAttributeOffset={posAttributeOffset}
            withUserSelectNone={withUserSelectNone}
            getClipboardSerializerPrefix={getClipboardSerializerPrefix}
            jumpAnimation={jumpAnimation}
        />
    );
}
