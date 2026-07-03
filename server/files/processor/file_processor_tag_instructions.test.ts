import {
    FileProcessorAnalysisResponseSchema,
    createFileProcessorAudioTranscriptTagInstructions,
    createFileProcessorVideoTagInstructions,
    fileProcessorImageTagInstructions,
} from "~/server/files/processor/file_processor_tag_instructions.js";
import {
    fileAnalysisCaptionMaxLength,
    fileAnalysisDescriptionMaxLength,
} from "~/shared/files/file_analysis.js";

test("analysis schema defaults tags when omitted", () => {
    expect(FileProcessorAnalysisResponseSchema.deserialize({})).toEqual({tags: []});
});

test("analysis schema trims caption, description, and tags", () => {
    expect(
        FileProcessorAnalysisResponseSchema.deserialize({
            caption: "  Cat in a window.  ",
            description: "  A cat sits in a sunny window. It looks outside.  ",
            tags: ["  cat  ", " window "],
        }),
    ).toEqual({
        caption: "Cat in a window.",
        description: "A cat sits in a sunny window. It looks outside.",
        tags: ["cat", "window"],
    });
});

test("image instructions describe the caption and paragraph description contract", () => {
    expect(fileProcessorImageTagInstructions).toContain(
        "`description` must be a short paragraph with 2-4 sentences",
    );
});

test("image instructions include stored caption and description length limits", () => {
    expect(fileProcessorImageTagInstructions).toEqual(
        expect.stringContaining(
            `\`caption\` must be at most ${fileAnalysisCaptionMaxLength} characters`,
        ),
    );
    expect(fileProcessorImageTagInstructions).toEqual(
        expect.stringContaining(
            `\`description\` must be at most ${fileAnalysisDescriptionMaxLength} characters`,
        ),
    );
});

test("image instructions omit the stored tags byte limit", () => {
    expect(fileProcessorImageTagInstructions).not.toContain("combined UTF-8 byte length");
});

test("audio instructions include transcript-only guidance and the transcript body", () => {
    expect(
        createFileProcessorAudioTranscriptTagInstructions("A short transcript about Alpine."),
    ).toMatch(
        /Base your answer only on the transcript below\.[\s\S]*## Transcript[\s\S]*A short transcript about Alpine\./,
    );
});

test("video instructions include transcript context when available", () => {
    expect(
        createFileProcessorVideoTagInstructions({
            transcript: "Narration about a product demo.",
        }),
    ).toEqual(
        expect.arrayContaining([
            expect.stringContaining("The following images are chronological frames sampled"),
            expect.stringContaining("## Transcript from the video audio"),
            expect.stringContaining("You are analyzing a single video for Alpine file search."),
        ]),
    );
});

test("video instructions omit transcript context when unavailable", () => {
    expect(createFileProcessorVideoTagInstructions({transcript: null})).toHaveLength(3);
});
