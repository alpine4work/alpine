import {ApiMentionPath} from "~/shared/api/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {
    MessageStreamReasoningPartPayload,
    MessageStreamToolCallPartPayload,
} from "~/shared/messaging/message_schema.js";

type SummarySection = {
    createdTime: Date;
    durationMs: number;
    isCompleted: boolean;
};

type MessageStreamReadSummarySection = SummarySection & {
    type: "Read";
    calls: Array<{targetPath: ApiMentionPath; title: string}>;
};

type MessageStreamSearchSummarySection = SummarySection & {
    type: "Search";
    calls: Array<{query: string}>;
};

type MessageStreamReasoningSummarySection = SummarySection & {
    type: "Reasoning";
    calls: Array<{content: MessageContent}>;
};

export type MessageStreamSummarySectionOptions =
    | MessageStreamReadSummarySection
    | MessageStreamSearchSummarySection
    | MessageStreamReasoningSummarySection;

export function createMessageStreamSummarySections({
    streamParts,
    messageCreatedTime,
    isThinkingSummaryComplete,
}: {
    streamParts: Array<{
        payload: MessageStreamToolCallPartPayload | MessageStreamReasoningPartPayload;
        createdTime: Date;
    }>;
    messageCreatedTime: Date;
    isThinkingSummaryComplete: boolean;
}) {
    // Initialize the first section. Since the stream part's parent message was created
    // before the request to the LLM was even made, it most closely represents the user's
    // interpretation of how long it took between sending their message and receiving the
    // first stream part.
    let currentSection: MessageStreamSummarySectionOptions = {
        type: streamParts[0]
            ? getMessageStreamSummarySectionTypeForStreamPart(streamParts[0])
            : "Reasoning",
        createdTime: messageCreatedTime,
        durationMs: 0,
        isCompleted: isThinkingSummaryComplete,
        calls: [],
    };
    const sections: Array<MessageStreamSummarySectionOptions> = [currentSection];

    for (let i = 0; i < streamParts.length; i++) {
        const {payload, createdTime} = streamParts[i]!;

        switch (payload.type) {
            case "ToolCall": {
                const currentToolCall = payload.call;
                switch (currentToolCall.type) {
                    case "Read": {
                        assert(currentSection.type === "Read");
                        // Add to current section (avoiding duplicates). For example, the read tool
                        // will read the same content multiple times while paginating.
                        if (
                            !currentSection.calls.some(
                                c => c.targetPath === currentToolCall.targetPath,
                            )
                        ) {
                            currentSection.calls.push({
                                targetPath: currentToolCall.targetPath,
                                title: currentToolCall.title,
                            });
                        }

                        break;
                    }
                    case "Search": {
                        assert(currentSection.type === "Search");
                        currentSection.calls.push({query: currentToolCall.query});
                        break;
                    }
                    default:
                        throw exhaustive(currentToolCall);
                }

                break;
            }
            case "Reasoning": {
                assert(currentSection.type === "Reasoning");
                currentSection.calls.push({content: payload.content});
                break;
            }
        }

        const nextStreamPart = streamParts[i + 1];

        if (!nextStreamPart && isThinkingSummaryComplete) {
            // This is the last section, so calculate its duration.
            currentSection.durationMs =
                createdTime.getTime() - currentSection.createdTime.getTime();
            currentSection.isCompleted = true;
        } else if (
            nextStreamPart &&
            getMessageStreamSummarySectionTypeForStreamPart(nextStreamPart) !== currentSection.type
        ) {
            currentSection.isCompleted = true;
            // Calculate the current section's duration and then create a new section.
            currentSection.durationMs =
                createdTime.getTime() - currentSection.createdTime.getTime();

            // Create the next section. Doing this here guarantees each part is in the
            // correct section and is also the reason that we can safely assert the
            // `currentSection.type` is correct!
            currentSection = {
                type: getMessageStreamSummarySectionTypeForStreamPart(nextStreamPart),
                // The "clock" for the next section starts as soon as this section ends. The end
                // of this section is marked by the `createdTime` of the last stream part in this
                // section, so we set the next section's start time to this section's end time.
                createdTime: createdTime,
                durationMs: 0,
                isCompleted: isThinkingSummaryComplete,
                calls: [],
            };
            sections.push(currentSection);
        }
    }

    return sections;
}

function getMessageStreamSummarySectionTypeForStreamPart(streamPart: {
    payload: MessageStreamToolCallPartPayload | MessageStreamReasoningPartPayload;
}) {
    switch (streamPart.payload.type) {
        case "ToolCall":
            return streamPart.payload.call.type;
        case "Reasoning":
            return "Reasoning";
        default:
            throw exhaustive(streamPart.payload);
    }
}
