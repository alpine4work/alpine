import {useSearchParams} from "@remix-run/react";
import {DotsThreeVertical, Link as LinkIcon} from "phosphor-react";
import {useEffect, useMemo, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {
    useCanManageSite,
    useFavoriteSiteMenuAction,
    useSite,
} from "~/client/web/sites/context/site_context.js";
import {SiteNameEditor} from "~/client/web/sites/internal/site_name_editor.js";
import {useSiteMutations} from "~/client/web/sites/internal/use_site_mutations.js";
import {doubleClickDelayMs} from "~/shared/design/core/timing.js";

/**
 * Top-level header that renders the active site's name at the outermost layer of
 * the site chrome. Double-click enters inline edit mode when the actor has
 * `Manage` access on the site (mirrors the `channel_view.tsx` rename gesture).
 *
 * Rendered by `renderSiteChrome` at `parentId === null`, so both the bare site
 * route and any entity route wrapped by `useSiteChromeContainer` see it.
 *
 * Opens directly in edit mode when the route loaded with `?focus=name` in the URL
 * — the create flow at `/site/$siteId?create=$spaceId&focus=name` uses this to
 * land the user straight on the name field. `SiteNameEditor` then auto-focuses its
 * own input via its `shouldInitiallyFocusSiteName` default, and we strip the
 * `focus` search param so a refresh doesn't replay it.
 */
export function SiteNameHeader() {
    const site = useSite();
    const canManage = useCanManageSite();
    const {renameSite} = useSiteMutations();
    const [searchParams, setSearchParams] = useSearchParams();
    const favoriteSiteMenuAction = useFavoriteSiteMenuAction();

    // Capture `?focus=name` once via a lazy initializer so we read the value before
    // the cleanup effect below removes the param. Gated on `canManage` — if the actor
    // can't rename the site, opening the editor would be a dead end.
    const [isEditing, setIsEditing] = useState(
        () => canManage && searchParams.get("focus") === "name",
    );

    // Strip the consumed `?focus` param so a refresh doesn't replay it and it doesn't
    // end up in shared links.
    useEffect(() => {
        if (!searchParams.has("focus")) return;
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.delete("focus");
        setSearchParams(newSearchParams, {replace: true});
    }, [searchParams, setSearchParams]);

    const lastPointerDownTimeRef = useRef<number | null>(null);

    const overflowMenuActions = useMemo<ReadonlyArray<ReadonlyArray<MenuAction>>>(
        () => [
            [
                ...(favoriteSiteMenuAction ? [favoriteSiteMenuAction] : []),
                {
                    label: "Copy link",
                    icon: <LinkIcon size={16} />,
                    pressErrorTitle: "Couldn\u2019t copy link",
                    onPress: async () => {
                        const url = new URL(`/site/${site.id}`, window.location.href);
                        await writeTextToClipboard(url.toString());
                    },
                },
            ],
        ],
        [site.id, favoriteSiteMenuAction],
    );

    if (isEditing) {
        return (
            <Box
                paddingRight="4"
                paddingTop="4"
                paddingBottom="4"
                borderBottom="grey-10"
                fontStyle="semi-bold"
            >
                <SiteNameEditor
                    initialName={site.name}
                    onCancel={() => setIsEditing(false)}
                    onSave={async name => {
                        await renameSite(name);
                        setIsEditing(false);
                    }}
                />
            </Box>
        );
    }

    return (
        <Box
            paddingRight="2"
            paddingTop="4"
            paddingBottom="4"
            borderBottom="grey-10"
            fontStyle="semi-bold"
            fontSize="100"
            display="flex"
            alignItems="center"
            gap="2"
        >
            <Box
                flexGrow="1"
                overflow="hidden"
                style={{
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                }}
            >
                <span
                    onPointerDown={event => {
                        if (!canManage) return;

                        const currentTime = Date.now();
                        const lastPointerDownTime = lastPointerDownTimeRef.current;
                        lastPointerDownTimeRef.current = currentTime;

                        if (lastPointerDownTime === null) return;
                        if (currentTime - lastPointerDownTime > doubleClickDelayMs) return;

                        // Suppress the browser's default double-click text selection so the input doesn't
                        // open with the previous selection still highlighted underneath.
                        event.preventDefault();

                        setIsEditing(true);
                    }}
                >
                    {site.name ?? "Loading..."}
                </span>
            </Box>
            <MenuButton placement="bottom-end" actions={overflowMenuActions}>
                <IconButton size="sm" description="Site menu" withoutTooltip={true}>
                    <DotsThreeVertical />
                </IconButton>
            </MenuButton>
        </Box>
    );
}
