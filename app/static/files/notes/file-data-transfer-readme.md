Implementation note for developers debugging file pastes from Alpine: Prefer parsing the `text/html`
content type over the `image/png` content type.

The `text/html` content type includes a link (that eventually expires) to the full resolution file
in the file's original format. Whereas `image/png` is a resized preview image always in PNG format.
We include `image/png` for compatibility with applications that don't support `text/html` content
type parsing.

As a general solution, you can respect the order of content types when deciding which content type
to use. MDN notes for implementors: "It is important to set the data in the right order, from
most-specific to least-specific" ([source][1]). We respect this and always add `text/html` first. As
an Alpine specific solution you can look for this comment in the pasted `text/html`.

[1]:
    https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Recommended_drag_types#dragging_images
