import {SitesInjection} from "~/server/context/injection_context_module.js";
import {dangerouslyGetSiteAccessPolicyWithoutAuthorization} from "~/server/sites/data/dangerously_get_site_access_policy_without_authorization.js";
import {getSitePreview} from "~/server/sites/data/get_site_preview.js";

export const sitesInjection: SitesInjection = {
    dangerouslyGetSiteAccessPolicyWithoutAuthorization,
    getSitePreview,
};
