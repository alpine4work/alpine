import {useEffect, useRef} from "react";
import {useRevalidator} from "~/client/web/remix/use_revalidator.js";
import {ResolvedAccessPolicy} from "~/shared/access/access_policy.js";
import {getSiteIdFromAccessPolicyIfExists} from "~/shared/access/get_site_id_from_access_policy_if_exists.js";

/**
 * Re-run route loaders when realtime state says the current entity moved into, out
 * of, or between sites.
 *
 * To render the site chrome around an entity, we load the site rynamo query with
 * the rest of the entity's route loader data, and store the site rynamo items at
 * the space-level (in the SiteContext).
 *
 * Then, we check that we (a) have an active Site Id and (b) the current entity
 * belongs to that Site before rendering the site chrome.
 *
 * In order to be absolutely certain that the site chrome is rendered around an
 * entity, we call remix's `revalidate()` function to force a reload of the
 * entity's route loader data if its site membership changes.
 */
// NOTE(ifitzsimmons, 2026-05-16): `accessPolicy` is very intentionally typed as
// `ResolvedAccessPolicy | null` instead of `AccessPolicy | null`. This is to avoid
// the chance of using this hook incorrectly. When using the access policy on the
// client, we rarely want the base `AccessPolicy` type as that is the access policy
// that is sent over the wire (in other words, it's often associated with the
// initial data).
//
// The ResolvedAccessPolicy, however, is always used to derive the true access
// policy downstream of any realtime updates (at time of writing). So if a Document
// belongs to a Site, and the Site's access policy changes, the document's
// _resolved_ access policy will be recomputed. Similary, if the document's access
// policy itself changes (e.g. removed from the site), the document's _resolved_
// access policy will be recomputed. In both cases, this hook will reload the
// route.
export function useRevalidateOnAccessPolicySiteChange(accessPolicy: ResolvedAccessPolicy | null) {
    const {revalidate} = useRevalidator();
    const siteId = accessPolicy ? getSiteIdFromAccessPolicyIfExists(accessPolicy) : null;
    const previousSiteIdRef = useRef(siteId);

    useEffect(() => {
        if (siteId === previousSiteIdRef.current) return;
        previousSiteIdRef.current = siteId;

        void revalidate();
    }, [revalidate, siteId]);
}
