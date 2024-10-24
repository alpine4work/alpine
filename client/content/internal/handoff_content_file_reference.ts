import {useState} from "react";
import {FileModel} from "~/shared/files/file_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {FileId} from "~/shared/id/types/id_types.js";

let handoffContentFileReferencesByFileId: Map<
    FileId,
    Set<{signedUrlSearch: string; file: FileModel}>
> | null = null;

/**
 * Handoff some previously loaded data to `<ContentFileViewerModal>` so
 * it doesn't have to fetch data from the server when it mounts.
 */
export function handoffContentFileReference(reference: {signedUrlSearch: string; file: FileModel}) {
    handoffContentFileReferencesByFileId ??= new Map();

    const handoffContentFileReferences = getOrSetDefaultMapValue(
        handoffContentFileReferencesByFileId,
        reference.file.id,
        () => new Set(),
    );

    if (handoffContentFileReferences.has(reference)) return;

    handoffContentFileReferences.add(reference);

    setTimeout(() => {
        handoffContentFileReferences.delete(reference);

        if (handoffContentFileReferences.size === 0)
            handoffContentFileReferencesByFileId?.delete(reference.file.id);
    }, 1000);
}

export function useHandoffContentFileReference(fileId: FileId) {
    return useState(() =>
        iterableFirst(handoffContentFileReferencesByFileId?.get(fileId) ?? emptyArray),
    )[0];
}
