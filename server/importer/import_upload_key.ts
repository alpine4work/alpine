import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.open_source.js";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection.js";
import {isId} from "~/shared/id/id.open_source.js";
import {NotionImportId} from "~/shared/id/types/id_types.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

export type ImportUploadKey = `${SpaceId}/notion/${NotionImportId}`;

export type ImportUploadKeyObject = {spaceId: SpaceId} & {
    type: "notion";
    importId: NotionImportId;
};

type ImportUploadService = ImportUploadKeyObject["type"];

type GetImportUploadKeyTestMapUnionType<Key extends string> =
    Key extends `${SpaceId}/${infer Type}/${string}`
        ? Record<Type, (importId: string) => boolean>
        : Record<Key, null>;

type GetImportUploadKeyTestMapType<Key extends string> = MergeObjectIntersection<
    UnionToIntersection<GetImportUploadKeyTestMapUnionType<Key>>
>;

const importUploadKeyTestMap: GetImportUploadKeyTestMapType<ImportUploadKey> = {
    notion: isId<NotionImportId>,
};

assertEqualTypes<keyof typeof importUploadKeyTestMap, ImportUploadKeyObject["type"]>();

function isImportUploadKey(key: string): key is ImportUploadKey {
    const parts = key.split("/", 3);
    if (parts.length !== 3) {
        return false;
    }

    const [spaceId, type, importId] = parts;

    if (!isId<SpaceId>(spaceId!)) return false;

    const pathTest = cast<{[key: string]: ((pathRest: string) => boolean) | null}>(
        importUploadKeyTestMap,
    )[type!];

    if (pathTest === undefined) return false;

    if (pathTest === null) {
        // Implies that `importId` is an empty string.
        return key === type;
    }

    return pathTest(importId!);
}

export function assertImportUploadKey(key: string): ImportUploadKey {
    assert(isImportUploadKey(key));
    return key;
}

export function createImportUploadKey(keyObject: ImportUploadKeyObject): ImportUploadKey {
    return `${keyObject.spaceId}/${keyObject.type}/${keyObject.importId}`;
}

export function parseImportUploadKey(key: ImportUploadKey): ImportUploadKeyObject {
    const [spaceId, idType, idPayload] = key.split("/", 3);

    const type = idType! as ImportUploadService;

    switch (type) {
        case "notion":
            return {
                type,
                spaceId: spaceId as SpaceId,
                importId: idPayload as NotionImportId,
            };
        default:
            throw exhaustive(type);
    }
}
