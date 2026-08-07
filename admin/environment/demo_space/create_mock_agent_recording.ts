import {
    decode as decodeO200kBaseTokens,
    encode as encodeO200kBaseTokens,
} from "gpt-tokenizer/esm/encoding/o200k_base";
import {
    MockAgentRecording,
    MockAgentRecordingAction,
} from "~/shared/agents/mock_agent_recording.js";
import {
    parseApiContentFromMarkdownTree,
    parseMarkdownTree,
} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";

export function createMockAgentRecording(
    paragraphs: Array<string | number>,
    {waitMillisecondsBetweenTokens = 0}: {waitMillisecondsBetweenTokens?: number} = {},
): MockAgentRecording {
    let index = 0;
    const recording: Array<MockAgentRecordingAction> = [];

    for (const paragraph of paragraphs) {
        if (typeof paragraph === "number") {
            recording.push({type: "Wait", milliseconds: paragraph});
            continue;
        }

        const chunkArray = <Value>(array: Array<Value>, n: number): Array<Array<Value>> => {
            const chunks: Array<Array<Value>> = [];

            for (let i = 0; i < array.length; i += n) {
                chunks.push(array.slice(i, i + n));
            }

            return chunks;
        };

        const paragraphTokens = chunkArray(encodeO200kBaseTokens(paragraph), 4).map(tokens =>
            decodeO200kBaseTokens(tokens),
        );

        let incrementalParagraph = "";

        for (const paragraphToken of paragraphTokens) {
            if (incrementalParagraph.length > 0 && waitMillisecondsBetweenTokens !== 0) {
                recording.push({type: "Wait", milliseconds: waitMillisecondsBetweenTokens});
            }

            incrementalParagraph += paragraphToken;

            recording.push({
                type: "PutPart",
                index,
                payload: {
                    type: "Content",
                    content: parseApiContentFromMarkdownTree(
                        parseMarkdownTree(incrementalParagraph, {
                            allowUndefinedLinkReferenceIdentifiers: true,
                            allowAttentionWithoutClose: true,
                            allowCodeTextWithoutClose: true,
                            allowLabelWithoutClose: true,
                            allowResourceWithoutClose: true,
                        }),
                    ),
                },
            });
        }

        index++;
    }

    return recording;
}
