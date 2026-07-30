/**
 * Shared prompt text for file tag generation.
 */

import {
    fileAnalysisCaptionMaxLength,
    fileAnalysisDescriptionMaxLength,
} from "~/shared/files/file_analysis.js";
import {PrettyMarkdown, markdown} from "~/shared/helpers/string/markdown.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Join markdown prompt sections into one markdown string.
 *
 * We keep each section as first-class markdown where possible, then join them at
 * runtime when we need to append dynamic content like a transcript.
 */
function joinMarkdownSections(parts: ReadonlyArray<string>): PrettyMarkdown {
    return parts.join("\n\n") as PrettyMarkdown;
}

function replaceMarkdownPlaceholder(
    prettyMarkdown: PrettyMarkdown,
    placeholder: string,
    value: string,
): PrettyMarkdown {
    return prettyMarkdown.replace(placeholder, value) as PrettyMarkdown;
}

/**
 * Structured analysis we ask the LLM to return for supported files.
 *
 * `caption` and `description` are optional so partial model responses can still
 * deserialize. The analysis normalization step decides whether the result is
 * useful enough to persist.
 */
export const FileProcessorAnalysisResponseSchema = Schema.object({
    caption: Schema.string.minLength(1).singleLine().trim().optional(),
    description: Schema.string.minLength(1).singleLine().trim().optional(),
    tags: Schema.array(Schema.string.minLength(1).singleLine().trim()).maxLength(10).default([]),
});

export type FileProcessorAnalysisResponse = SchemaType<typeof FileProcessorAnalysisResponseSchema>;

/**
 * Baseline instructions shared across image, audio, and video analysis.
 *
 * We keep the wording strict here because we want output that is both
 * machine-readable and directly usable for search/description storage.
 */
const fileProcessorTagAndDescriptionInstructionsTemplate = markdown`
## Output requirements

### General

- Prefer concrete objects, actions, places, products, interfaces, and text topics when visible.
- Do not include duplicates, markdown, or commentary.

### \`tags\`

- \`tags\` must be an array of 5-10 short lowercase strings ordered by relevance.
- Tags should be concise, search-oriented keywords or short noun phrases.

### \`caption\`

- \`caption\` must be one concise sentence describing the file contents and useful as alt text.
- \`caption\` must be at most {CAPTION_MAX_LENGTH} characters.
- Write only the caption itself, not an explanation of what you are describing.
    - Do not start \`caption\` with phrases like \u201CThe image shows\u201D, \u201CThe file
      describes\u201D, \u201CThis audio contains\u201D, or similar lead-in text.

### \`description\`

- \`description\` must be a short paragraph with 2-4 sentences that describes the file contents in
  more detail.
- \`description\` must be at most {DESCRIPTION_MAX_LENGTH} characters.
- Write only the description itself in plain text.
    - Do not start \`description\` with phrases like \u201CThe image shows\u201D, \u201CThe file
      describes\u201D, \u201CThis audio contains\u201D, or similar lead-in text.
`;

const fileProcessorTagAndDescriptionInstructions = replaceMarkdownPlaceholder(
    replaceMarkdownPlaceholder(
        fileProcessorTagAndDescriptionInstructionsTemplate,
        "{CAPTION_MAX_LENGTH}",
        String(fileAnalysisCaptionMaxLength),
    ),
    "{DESCRIPTION_MAX_LENGTH}",
    String(fileAnalysisDescriptionMaxLength),
);

export const fileProcessorImageTagInstructions = joinMarkdownSections([
    markdown`
You are analyzing a single image for Alpine file search.
    `,
    fileProcessorTagAndDescriptionInstructions,
]);

/**
 * Builds the prompt used when file analysis is derived from a transcript-only
 * audio input.
 */
export function createFileProcessorAudioTranscriptTagInstructions(
    transcript: string,
): PrettyMarkdown {
    return joinMarkdownSections([
        markdown`
You are analyzing an audio transcript for Alpine file search.

Base your answer only on the transcript below.
        `,
        fileProcessorTagAndDescriptionInstructions,
        markdown`
## Transcript
        `,
        transcript,
    ]);
}

/**
 * Builds the prompt used when file analysis is derived from sampled video frames
 * and, when available, an audio transcript.
 */
export function createFileProcessorVideoTagInstructions({
    transcript,
}: {
    transcript: string | null;
}): Array<PrettyMarkdown> {
    const instructions: Array<PrettyMarkdown> = [
        markdown`
The following images are chronological frames sampled from one video.

Use all frames together as one sequence.
        `,
    ];

    if (transcript !== null) {
        instructions.push(
            joinMarkdownSections([
                markdown`
## Transcript from the video audio
                `,
                transcript,
            ]),
        );
    }

    instructions.push(
        markdown`
You are analyzing a single video for Alpine file search.
        `,
        fileProcessorTagAndDescriptionInstructions,
    );

    return instructions;
}
