import {MessageInputFile} from "~/client/web/content/messaging/add_message_input_files.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";

function getMessageInputFileId(inputFile: MessageInputFile): FileId | FileEntityId {
    switch (inputFile.type) {
        case "FileEntity":
            return inputFile.fileEntityId;
        case "File":
            return inputFile.file.id;
        default:
            throw exhaustive(inputFile);
    }
}

export function getMessageInputFileIds(
    inputFiles: ReadonlyArray<MessageInputFile>,
): ReadonlyArray<FileId | FileEntityId> {
    return inputFiles.map(getMessageInputFileId);
}
