import {FileModelRegistryData, FileRegistry} from "~/client/web/content/file_registry.js";
import {
    createGlobalContext,
    getGlobalContext,
    useGlobalContext,
} from "~/client/web/helpers/global_context.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {FileModel} from "~/shared/files/file_model.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

const FileRegistryContext = createGlobalContext(() => new Map<SpaceId, FileRegistry>());

export function getFileRegistry(spaceId: SpaceId): FileRegistry {
    return getOrSetDefaultMapValue(
        getGlobalContext(FileRegistryContext),
        spaceId,
        () => new FileRegistry(spaceId),
    );
}

export function useFileRegistry(): FileRegistry {
    const {space} = useSpaceContext();
    return getOrSetDefaultMapValue(
        useGlobalContext(FileRegistryContext),
        space.id,
        () => new FileRegistry(space.id),
    );
}

export function useFileModel(
    file: {signedUrlSearch: string; file: FileModel} | FileModelRegistryData,
): FileModelRegistryData {
    const fileRegistry = useFileRegistry();

    const fileData = useStore("file" in file ? fileRegistry.getFileStore(file) : null);

    if (fileData === null) {
        return file as FileModelRegistryData;
    } else {
        return fileData;
    }
}
