import {SitesInjection} from "~/server/context/injection_context_module.js";
import {dangerouslyGetAddToSiteTransactionEntries} from "~/server/sites/data/dangerously_get_add_to_site_transaction_entries.js";
import {dangerouslyGetRemoveFromSiteTransactionEntries} from "~/server/sites/data/dangerously_get_remove_from_site_transaction_entries.js";
import {dangerouslyGetSiteAccessPolicyReplicaWithoutAuthorization} from "~/server/sites/data/dangerously_get_site_access_policy_replica_without_authorization.js";
import {dangerouslyGetSiteAccessPolicyWithoutAuthorization} from "~/server/sites/data/dangerously_get_site_access_policy_without_authorization.js";
import {getSitePreview} from "~/server/sites/data/get_site_preview.js";

export const sitesInjection: SitesInjection = {
    dangerouslyGetSiteAccessPolicyWithoutAuthorization,
    dangerouslyGetSiteAccessPolicyReplicaWithoutAuthorization,
    getSitePreview,
    dangerouslyGetAddToSiteTransactionEntries,
    dangerouslyGetRemoveFromSiteTransactionEntries,
};
