import {useState} from "react";
import {FileModel} from "~/shared/files/file_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {FileId} from "~/shared/id/types/id_types.js";

let handoffContentFilePreviewStatesByFileId: Map<
    FileId,
    Set<{
        ownedByElement: Element;
        signedUrlSearch: string;
        file: FileModel;
    }>
> | null = null;

/**
 * Handoff some previously loaded data to `<ContentFileViewerModal>` so it doesn't
 * have to fetch data from the server when it mounts.
 */
export function handoffContentFilePreviewState(state: {
    ownedByElement: Element;
    signedUrlSearch: string;
    file: FileModel;
}) {
    handoffContentFilePreviewStatesByFileId ??= new Map();

    const handoffContentFilePreviewStates = getOrSetDefaultMapValue(
        handoffContentFilePreviewStatesByFileId,
        state.file.id,
        () => new Set(),
    );

    if (handoffContentFilePreviewStates.has(state)) return;

    handoffContentFilePreviewStates.add(state);

    setTimeout(() => {
        handoffContentFilePreviewStates.delete(state);

        if (handoffContentFilePreviewStates.size === 0)
            handoffContentFilePreviewStatesByFileId?.delete(state.file.id);
    }, 1000);
}

export function useHandoffContentFilePreviewState(fileId: FileId) {
    return useState(() =>
        iterableFirst(handoffContentFilePreviewStatesByFileId?.get(fileId) ?? emptyArray),
    )[0];
}
