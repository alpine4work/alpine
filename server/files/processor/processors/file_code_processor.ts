import {NodeType, Tree} from "@lezer/common";
import {highlightCode} from "@lezer/highlight";
import {Writable as WritableStream} from "stream";
import {FileProcessor} from "~/server/files/processor/processors/file_processor.js";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {lezerClassHighlighter} from "~/shared/content/code/lezer_class_highlighter.js";
import {
    FileCodePreviewContent,
    maxFileCodePreviewLineCodePointCount,
    maxFileCodePreviewLineCount,
} from "~/shared/files/file_code_preview_content.js";
import {
    FileCodeContentType,
    getFileContentTypeContentCodeBlockLanguageId,
} from "~/shared/files/file_content_type.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

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
                const parserPromise = language.getParser()?.promise;

                let string = "";
                const promiseResolver = createPromiseResolver();

                {
                    let streamLineCount = 1;

                    // This code is a little simpler if we attach `stream.on("data")` and
                    // `stream.on("end")` listeners. However, according to the Node.js
                    // documentation this may cause problems:
                    //
                    // > ##### Choose one API style
                    // >
                    // > The `Readable` stream API evolved across multiple Node.js versions and
                    // > provides multiple methods of consuming stream data. In general,
                    // > developers should choose one of the methods of consuming data and
                    // > should never use multiple methods to consume data from a single
                    // > stream. Specifically, using a combination of `on('data')`,
                    // > `on('readable')`, `pipe()`, or async iterators could lead to
                    // > unintuitive behavior.
                    //
                    // Given we use this to consume data from a stream we also consume with
                    // `.pipe()` (the `req` body in an `uploadFile()` HTTP request) let's be
                    // consistent and use `.pipe()` here too.
                    const writableStream = new WritableStream({
                        write: (chunk: Buffer, encoding, callback) => {
                            const chunkString = chunk.toString("utf8");
                            string += chunkString;

                            let offset = 0;
                            while (true) {
                                const index = chunkString.indexOf("\n", offset);
                                if (index === -1) break;
                                streamLineCount += 1;
                                offset = index + 1;
                            }

                            if (streamLineCount >= fileCodePreviewWaitForLineCount) {
                                writableStream.off("error", handleError);
                                signal.removeEventListener("abort", handleAbort);
                                promiseResolver.resolve();

                                // Unpipe the stream so we don't receive any more data.
                                stream.unpipe(writableStream);
                            }

                            callback();
                        },
                        final: callback => {
                            writableStream.off("error", handleError);
                            signal.removeEventListener("abort", handleAbort);

                            promiseResolver.resolve();

                            callback();
                        },
                    });

                    const handleError = (error: unknown) => {
                        writableStream.off("error", handleError);
                        signal.removeEventListener("abort", handleAbort);

                        promiseResolver.reject(error);

                        // Unpipe the stream so we don't receive any more data.
                        stream.unpipe(writableStream);
                    };

                    const handleAbort = () => {
                        writableStream.off("error", handleError);
                        signal.removeEventListener("abort", handleAbort);

                        promiseResolver.reject(signal.reason);

                        // Unpipe the stream so we don't receive any more data.
                        stream.unpipe(writableStream);
                    };

                    writableStream.on("error", handleError);
                    signal.addEventListener("abort", handleAbort);

                    stream.pipe(writableStream);
                }

                const [parser] = await runAllPromises([parserPromise, promiseResolver.promise]);

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
