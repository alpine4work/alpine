import {NodeType, Tree} from "@lezer/common";
import {highlightCode} from "@lezer/highlight";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {lezerClassHighlighter} from "~/shared/content/code/lezer_class_highlighter.js";
import {getFileContentTypeContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {
    FileCodePreviewContent,
    maxFileCodePreviewLineCodePointCount,
    maxFileCodePreviewLineCount,
} from "~/shared/files/file_code_preview_content.js";
import {FileCodeContentType} from "~/shared/files/file_content_type.js";

const fileCodePreviewWaitForLineCount = 128;

export function createFileCodeProcessor(contentType: FileCodeContentType): FileProcessor {
    const languageId = getFileContentTypeContentCodeBlockLanguageId(contentType);
    const language = contentCodeBlockLanguageById[languageId];

    return {
        type: "Code",
        hasAlternative: false,
        hasPreview: {type: "Code"},
        process: (stream, signal) => {
            const codePreviewContentPromise = (async () => {
                const parser = await language.getParser()?.promise;

                // Receive data from stream until we've received a certain number of lines.
                // Then stop waiting for data. Next we'll parse the data we've received...
                const string = await new Promise<string>((resolve, reject) => {
                    if (stream.readableEnded) {
                        resolve("");
                        return;
                    }

                    if (signal.aborted) {
                        reject(signal.reason);
                        return;
                    }

                    let string = "";
                    let lineCount = 1;

                    const handleData = (chunk: Buffer) => {
                        const chunkString = chunk.toString("utf8");
                        string += chunkString;

                        let offset = 0;
                        while (true) {
                            const index = chunkString.indexOf("\n", offset);
                            if (index === -1) break;
                            lineCount += 1;
                            offset = index + 1;
                        }

                        if (lineCount >= fileCodePreviewWaitForLineCount) {
                            stream.off("data", handleData);
                            stream.off("end", handleEnd);
                            stream.off("error", handleError);
                            signal.removeEventListener("abort", handleAbort);
                            resolve(string);
                        }
                    };

                    const handleEnd = () => {
                        stream.off("data", handleData);
                        stream.off("end", handleEnd);
                        stream.off("error", handleError);
                        signal.removeEventListener("abort", handleAbort);
                        resolve(string);
                    };

                    const handleError = (error: unknown) => {
                        stream.off("data", handleData);
                        stream.off("end", handleEnd);
                        stream.off("error", handleError);
                        signal.removeEventListener("abort", handleAbort);
                        reject(error);
                    };

                    const handleAbort = () => {
                        stream.off("data", handleData);
                        stream.off("end", handleEnd);
                        stream.off("error", handleError);
                        signal.removeEventListener("abort", handleAbort);
                        reject(signal.reason);
                    };

                    stream.on("data", handleData);
                    stream.on("end", handleEnd);
                    stream.on("error", handleError);
                    signal.addEventListener("abort", handleAbort);
                });

                const content: Array<
                    {type: "Newline"} | {type: "String"; classes: string; string: string}
                > = [];
                let lineCount = 0;
                let lineCodePointCount = 0;

                highlightCode(
                    string,
                    parser ? parser.parse(string) : new Tree(NodeType.none, [], [], string.length),
                    lezerClassHighlighter.get(),
                    (substring, classes) => {
                        if (lineCount >= maxFileCodePreviewLineCount) return;
                        if (lineCodePointCount >= maxFileCodePreviewLineCodePointCount) return;

                        let substringCodePoints = Array.from(substring);

                        if (
                            lineCodePointCount + substringCodePoints.length >
                            maxFileCodePreviewLineCodePointCount
                        ) {
                            substringCodePoints = substringCodePoints.slice(
                                0,
                                maxFileCodePreviewLineCodePointCount - lineCodePointCount,
                            );
                        }

                        lineCodePointCount += substringCodePoints.length;

                        content.push({
                            type: "String",
                            classes,
                            string: substringCodePoints.join(""),
                        });
                    },
                    () => {
                        if (lineCount >= maxFileCodePreviewLineCount) return;

                        lineCount += 1;
                        lineCodePointCount = 0;

                        content.push({type: "Newline"});
                    },
                );

                return new FileCodePreviewContent(content);
            })();

            return {
                codePreviewContentPromise,
            };
        },
    };
}
