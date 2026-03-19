export function allowShareOverlayEscapeGlobalKeyDownDefault(event: KeyboardEvent) {
    // If the focused element is a combobox input, `<MenuButton>`, menu item that's
    // open, or inside a `<Modal>`, and the user hits escape then we want the escape
    // keydown to close the focused element's overlay.
    return (
        event.target instanceof HTMLElement &&
        (event.target.getAttribute("aria-expanded") === "true" ||
            event.target.role === "menuitem" ||
            event.target.closest("[aria-modal=true]"))
    );
}
