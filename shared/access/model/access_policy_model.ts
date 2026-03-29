// NOTE(ifitzsimmons, 2026-03-04): This file needs it's own bazel package because
// the access policy model depends on the site preview model and site preview model
// depends on `LocalAccessPolicy`. This would create a circular dependency if we
// defined the `AccessPolicyModel` in the `shared/access` package (specifically, in
// `shared/access/access_policy.ts`).
import {AccessPolicy, LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

export const AccessPolicyModelDataSchema = Schema.union({
    Local: LocalAccessPolicySchema,
    Site: Schema.object({
        type: Schema.value("Site"),
        site: SitePreviewModel.schema,
    }),
});

export type AccessPolicyModelData = SchemaType<typeof AccessPolicyModelDataSchema>;

export class AccessPolicyModel {
    public readonly data: AccessPolicyModelData;

    constructor(data: AccessPolicyModelData) {
        this.data = data;
    }

    public static readonly schema = AccessPolicyModelDataSchema.transform<AccessPolicyModel>({
        serialize: site => site.data,
        deserialize: site => new AccessPolicyModel(site),
    });

    public intoAccessPolicy(): AccessPolicy {
        switch (this.data.type) {
            case "Local":
                return this.data;
            case "Site":
                return {
                    type: "Site",
                    siteId: this.data.site.id,
                };
            default:
                throw exhaustive(this.data);
        }
    }
}
