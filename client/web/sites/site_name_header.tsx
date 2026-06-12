import {useMemo, useRef} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {LockBoldFillIcon} from "~/client/web/icons/lock_bold_fill_icon.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSiteContext} from "~/client/web/sites/context/site_context.js";
import {SiteNameEditor} from "~/client/web/sites/internal/site_name_editor.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {doubleClickDelayMs} from "~/shared/design/core/timing.js";
import {updateSiteName} from "~/shared/rpc/sites_rpc_definitions.js";
import {SitePreviewModelData} from "~/shared/sites/site_model.js";

export function SiteNameHeader({
    site,
    setIsEditingNameInline,
    isEditingNameInline,
}: {
    site: SitePreviewModelData;
    setIsEditingNameInline: (isEditing: boolean) => void;
    isEditingNameInline: boolean;
}) {
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const platform = usePlatform();
    const siteContext = useSiteContext();

    const lastPointerDownTimeRef = useRef<number | null>(null);

    const accessPolicy = site.accessPolicy;

    const accessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
        [accessPolicy, currentAccount?.id],
    );

    return (
        <Box
            display="flex"
            alignItems="center"
            gap={platform === "mobile" ? "1.5" : "2"}
            minWidth="0"
            height="9"
        >
            {!accessPolicy.defaultGrant && !accessPolicy.urlGrant && (
                // TODO(#sites-redesign): I do think there's value in making it clear that a Site
                // is private/public, but I don't think the channel approach is the best way to do
                // it. \
                // We add a lock icon to private sites because we want the access to be super
                // obvious to the user while they quickly create content in the site chrome, which
                // can feel a little detached from the site's permissions switch.
                <LockBoldFillIcon
                    className={sprinkles({flexShrink: "0"})}
                    size={spacing[platform === "mobile" ? "3" : "4"]}
                />
            )}
            {isEditingNameInline ? (
                <SiteNameEditor
                    initialName={site.name}
                    onCancel={() => setIsEditingNameInline(false)}
                    onSave={async name => {
                        const {events} = await updateSiteName(context, {
                            siteId: site.id,
                            name,
                        });

                        setIsEditingNameInline(false);

                        // Immediately apply a realtime event transaction to update our site in case our
                        // realtime WebSocket connection is slow.
                        siteContext.handleEventForSite([events]);
                    }}
                />
            ) : (
                <Box
                    onPointerDown={event => {
                        const currentTime = Date.now();
                        const lastPointerDownTime = lastPointerDownTimeRef.current;
                        lastPointerDownTimeRef.current = currentTime;

                        if (lastPointerDownTime === null) return;

                        if (currentTime - lastPointerDownTime > doubleClickDelayMs) return;

                        if (hasAccessLevel(accessLevel, "Manage") && platform !== "mobile") {
                            // Disable selection from double click.
                            //
                            // We implement double click with `onPointerDown` instead of `onDoubleClick`
                            // because `onDoubleClick` fires one pointer up but the browser performs text
                            // selection on double click pointer down. So there's a small visual glitch where
                            // you can see the browser selection after double click before pointer up when you
                            // use `onDoubleClick`,
                            event.preventDefault();

                            setIsEditingNameInline(true);
                        }
                    }}
                >
                    {site.name}
                </Box>
            )}
        </Box>
    );
}
