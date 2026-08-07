import {FileContentType} from "~/shared/files/file_content_type.open_source.js";
import {FileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {
    FileNounCountState,
    formatFileNounWithAdjacentCount,
} from "~/shared/files/format_file_noun_with_adjacent_count.js";
import {getFileContentTypeStartOfSentenceNoun} from "~/shared/files/get_file_content_type_noun.open_source.js";
import {getFileEntityStartOfSentenceNoun} from "~/shared/files/get_file_entity_noun.js";
import {isId} from "~/shared/id/id.open_source.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";

export type {FileNounCountState};

/**
 * Resolve an array of file IDs to formatted noun strings with adjacent counting.
 * Returns one string per file, e.g. `["Image", "Image 2", "Video"]`.
 *
 * Accepts an optional `state` to carry counting across consecutive calls (e.g.
 * across adjacent file rows in ProseMirror content). The returned `nextState`
 * should be passed as `state` to the next call.
 *
 * This is the file-row formatting logic extracted from
 * `printContentSingleLineTextSnippetPreservingMarks` so it can be reused for
 * message payload files which are not ProseMirror nodes.
 */
export function printContentSingleLineTextSnippetForFileRow(
    fileIds: ReadonlyArray<FileId | FileEntityId | null>,
    getFileIfExists: (fileId: FileId) => {readonly contentType: FileContentType} | null,
    state?: FileNounCountState,
): {parts: Array<string>; nextState: FileNounCountState} {
    const parts: Array<string> = [];
    let currentState: FileNounCountState = state ?? null;

    for (const fileId of fileIds) {
        let noun: string;
        if (!fileId) {
            noun = getFileContentTypeStartOfSentenceNoun("application/octet-stream");
        } else if (isId<FileId>(fileId)) {
            const file = getFileIfExists(fileId);
            noun = getFileContentTypeStartOfSentenceNoun(file?.contentType);
        } else {
            noun = getFileEntityStartOfSentenceNoun(parseFileEntityId(fileId).type);
        }

        const result = formatFileNounWithAdjacentCount(noun, currentState);
        parts.push(result.text);
        currentState = result.nextState;
    }

    return {parts, nextState: currentState};
}
