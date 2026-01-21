# AGENTS.md

This package implements the rich text editor used everywhere throughout Alpine. The editor is
implemented using ProseMirror.

- `<ContentEditor>` (`client/web/content/content_editor.tsx`): The React component for our rich text
  editor. Has a custom integration with ProseMirror’s `EditorView` class.

- `<ContentView>` (`client/web/content/content_view.tsx`): The React component for rendering rich
  text content in read-only mode. We implement a custom ProseMirror to HTML serializer in
  `client/web/content/render_content_to_html.ts`.

## `HtmlGenerator`

Interactive elements within rich text content are implemented with a custom `HtmlGenerator`
framework (`shared/helpers/html/html_generator.ts`). This framework allows us to build HTML elements
without DOM access (for server side rendering) and has basic patching capabilities which means it
can work similarly to React’s virtual DOM diffing/patching.

Our drag-and-drop rich text image attachment implementation (called "files" in code) is a good
example of heavy use of `HtmlGenerator`. File preview rendering is implemented in
`client/web/content/internal/content_file_preview.ts` and there are two important functions:

1. `renderContentFilePreview()`: Renders a file preview and returns an `HtmlGenerator`. Whenever the
   inputs to this function change we call `renderContentFilePreview()` again and
   `HtmlGenerator.patchNode()` to update the DOM.

2. `addContentFilePreviewBehavior()`: Similar to a `useEffect()` in React. Runs after the HTML
   rendered by `renderContentFilePreview()` is added to the DOM and adds event listeners. Returns a
   cleanup function that removes any event listeners. Whenever the inputs to this function change we
   call the cleanup function and then call `addContentFilePreviewBehavior()` again (similar to a
   `useEffect()`).

These functions are called by ProseMirror’s `EditorView` by our custom file node view
(`client/web/content/internal/content_editor_file_node_view.ts`) for `<ContentEditor>`. For
`<ContentView>` `renderContentToHtml()` calls `renderContentFilePreview()` and then there’s a
`useEffect()` in `<ContentView>` calling `addContentFilePreviewBehavior()`. Finally, there’s a
`<ContentFilePreview>` component which just renders a single file as a React component and uses the
`HtmlGenerator`-based `content_file_preview.ts` implementation.

Files are the most advanced usage of `HtmlGenerator` today but there are many other interactive
elements in `<ContentEditor>` that leverage the basic pattern of `HtmlGenerator` for rendering
and/or “add behavior” functions for event listening (e.g. `addUnfocusableButtonBehaviorToElement()`
for adding basic button behavior).

## Best practices

### When creating a ProseMirror transaction always update the absolute least amount possible

When you’re creating a ProseMirror transaction to update rich text (e.g. `state.tr.replace(...)`)
never update more than you need! For example, if you’re replacing the word `dog` with `monkey` in a
paragraph, you could write it like this:

```ts
function replaceBad(state: EditorState, textPos: number, textNode: Node) {
    const transaction = state.tr.replaceWith(
        textPos,
        textPos + textNode.text.length,
        textNode.type.schema.text(textNode.text.replaceAll("dog", "monkey")),
    );

    state.dispatch(transaction);
}
```

Instead, write it like this:

```ts
function replaceGood(state: EditorState, textPos: number, textNode: Node) {
    const transaction = state.tr;

    for (const match of textNode.text.matchAll("dog")) {
        transaction.replaceWith(
            textPos + match.index,
            textPost + match.index + match[0].length,
            textNode.type.schema.text("monkey"),
        );
    }

    state.dispatch(transaction);
}
```

Why? Replacing large chunks of a ProseMirror doc breaks collaborative editing! If a user is typing
at some other point in the text then `replaceBad()` will clobber their update and the other user
will lose their changes.

Other reasons `replaceGood()` is better:

- ProseMirror decorations that maintain their position via mappings will be lost with `replaceBad()`
  (since they can’t be mapped to the new position)

- `replaceGood()` results in smaller steps that will be saved on our backend, therefore we have to
  pay less to store the change from `replaceGood()`.
