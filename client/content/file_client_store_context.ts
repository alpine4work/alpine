import {FileClientStore, FileClientStoreData} from "~/client/content/file_client_store.js";
import {
    createGlobalContext,
    getGlobalContext,
    useGlobalContext,
} from "~/client/helpers/global_context.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {FileModel} from "~/shared/files/file_model.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

const FileClientStoreContext = createGlobalContext(() => new Map<SpaceId, FileClientStore>());

export function getFileClientStore(spaceId: SpaceId): FileClientStore {
    return getOrSetDefaultMapValue(
        getGlobalContext(FileClientStoreContext),
        spaceId,
        () => new FileClientStore(spaceId),
    );
}

export function useFileClientStore(): FileClientStore {
    const {space} = useSpaceContext();

    return getOrSetDefaultMapValue(
        useGlobalContext(FileClientStoreContext),
        space.id,
        () => new FileClientStore(space.id),
    );
}

export function useFileModel(
    file: {signedUrlSearch: string; file: FileModel} | FileClientStoreData,
): FileClientStoreData {
    const store = useFileClientStore();

    const fileData = useStore("file" in file ? store.getFileStore(file) : null);

    if (fileData === null) {
        return file as FileClientStoreData;
    } else {
        return fileData;
    }
}
