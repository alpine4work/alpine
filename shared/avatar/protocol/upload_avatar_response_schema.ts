import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

const UploadAvatarSuccessResponseSchema = Schema.union({
    UploadAccountAvatar: Schema.object({
        type: Schema.value("UploadAccountAvatar"),
        ok: Schema.value(true),
        account: AccountModelWithoutSpace.schema,
    }),
    UploadSpaceAvatar: Schema.object({
        type: Schema.value("UploadSpaceAvatar"),
        ok: Schema.value(true),
        space: SpaceModel.schema(),
    }),
});

export const UploadAvatarResponseSchema = Schema.result(
    UploadAvatarSuccessResponseSchema,
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
