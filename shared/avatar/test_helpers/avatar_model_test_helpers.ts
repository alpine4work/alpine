import {AvatarModel} from "~/shared/avatar/avatar_schema.js";
import {AvatarId} from "~/shared/id/types/id_types.open_source.js";

export const defaultAvatarContent = new Uint8Array([1, 2, 3]);

export function createTestAvatarModel({
    avatarId = null,
    content = null,
    version = 1,
}: Partial<{
    avatarId: AvatarId | null;
    content: Uint8Array | null;
    version: number;
}> = {}): AvatarModel {
    return {
        avatarId,
        content,
        version,
    };
}
