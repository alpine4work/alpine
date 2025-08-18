import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const UploadAvatarResponseSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        account: AccountModelWithoutSpace.schema,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
