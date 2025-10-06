import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {isId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {visitProsemirrorNode} from "~/shared/prosemirror/prosemirror_visitor.js";

export function getPostContentFileIds(content: PostContent): Set<FileId> {
    const fileIds = new Set<FileId>();

    visitProsemirrorNode(content, {
        visitAttr: (attr, value) => {
            if (attr === "fileId") {
                const fileId: FileId | FileEntityId | null = value;
                if (fileId !== null && isId<FileId>(fileId)) {
                    fileIds.add(fileId);
                }
            }
        },
    });

    return fileIds;
}
