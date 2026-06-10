export function allowShareOverlayEscapeGlobalKeyDownDefault(event: KeyboardEvent) {
    // If the focused element is a combobox input, `<MenuButton>`, menu item that's
    // open, or inside a `<Modal>`, and the user hits escape then we want the escape
    // keydown to close the focused element's overlay not the share overlay.
    return (
        event.target instanceof HTMLElement &&
        (event.target.getAttribute("aria-expanded") === "true" ||
            (event.target.role === "menuitem" &&
                // If this menu item is in `role=menubar` (e.g. the menu bar in the space create
                // button) then the menubar is always visible. So escape won't close the menubar.
                event.target.closest("[role=menu]")) ||
            event.target.closest("[aria-modal=true]"))
    );
}
