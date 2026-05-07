import {
    AccessPolicy,
    LocalAccessPolicySchema,
    SiteAccessPolicySchema,
} from "~/shared/access/access_policy.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SiteContainerIdSchema} from "~/shared/sites/site_entry_id.js";

export type CreateOrUpdateAccessPolicy = SchemaType<typeof CreateOrUpdateAccessPolicySchema>;
export const CreateOrUpdateAccessPolicySchema = Schema.union({
    Local: LocalAccessPolicySchema,
    Site: SiteAccessPolicySchema.merge(
        Schema.object({
            position: Schema.object({
                parentId: SiteContainerIdSchema,
                orderKey: OrderKeySchema,
            }),
        }),
    ),
});

assertAssignableTypes<CreateOrUpdateAccessPolicy, AccessPolicy>();
