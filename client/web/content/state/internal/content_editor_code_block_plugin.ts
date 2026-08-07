import {EditorState, Plugin, PluginKey} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ContentCodeBlockIncrementalParser} from "~/shared/content/code/content_code_block_incremental_parser.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {Store} from "~/shared/store/store.js";

type ContentEditorCodeBlockStateValue = {
    readonly dependencyStores: ReadonlySet<Store<any>> | null;
    readonly parser: ContentCodeBlockIncrementalParser;
};

type ContentEditorCodeBlockState =
    | ContentEditorCodeBlockStateValue
    | Lazy<ContentEditorCodeBlockStateValue>;

const contentEditorCodeBlockPluginKey = new PluginKey<ContentEditorCodeBlockState>(
    "contentEditorCodeBlock",
);

/**
 * Plugin for managing code block behavior. Including:
 *
 * - Syntax highlighting
 * - Trailing space cleanup
 */
export function contentEditorCodeBlockPlugin() {
    return new Plugin<ContentEditorCodeBlockState>({
        key: contentEditorCodeBlockPluginKey,
        state: {
            init: (config, state) =>
                // We want to lazily initialize `ContentCodeBlockIncrementalParser` when
                // `EditorView` is available. (In other words, in an effect after
                // `isInitialAppRender`). We don't want to initialize
                // `ContentCodeBlockIncrementalParser` on `ContentEditorState.create()`!
                //
                // On initial server render, `<ContentView>` sets the initial server rendered
                // decorations to
                // `ContentCodeBlockIncrementalParser.getInitialDecorationsByNode()`. This only
                // happens after `<ContentView>` is rendered and `<ContentView>` is rendered after
                // `ContentEditorState.create()` is called.
                //
                // By lazily initializing `ContentCodeBlockIncrementalParser` we'll initialize
                // after `<ContentView>` has been rendered and our initial server rendered
                // decorations are discovered.
                new Lazy(() => {
                    let dependencyStores: Set<Store<any>> | null = null;

                    const parser = ContentCodeBlockIncrementalParser.new(store => {
                        if (!store.isFinal()) {
                            dependencyStores ??= new Set();
                            dependencyStores.add(store);
                        }

                        return store.getSnapshot();
                    }, state.doc);

                    return {
                        dependencyStores,
                        parser,
                    };
                }),

            apply: (transaction, oldPluginState) => {
                if (
                    !transaction.docChanged &&
                    !transaction.getMeta(contentEditorCodeBlockPluginKey)
                ) {
                    return oldPluginState;
                }

                oldPluginState =
                    oldPluginState instanceof Lazy ? oldPluginState.get() : oldPluginState;

                const {dependencyStores: oldDependencyStores} = oldPluginState;
                let newDependencyStores: Set<Store<any>> | null = null;

                const parser = oldPluginState.parser.update(
                    store => {
                        if (!store.isFinal()) {
                            newDependencyStores ??= new Set();
                            newDependencyStores.add(store);
                        }

                        return store.getSnapshot();
                    },
                    transaction.doc,
                    transaction.mapping,
                );

                return {
                    // If `dependencyStores` didn't change then reuse the old value from `pluginState`
                    // so we don't have to re-subscribe.
                    dependencyStores:
                        newDependencyStores !== null &&
                        oldDependencyStores !== null &&
                        iterableEvery(newDependencyStores, store =>
                            oldDependencyStores.has(
                                // @ts-expect-error: `store` is the right type here but TypeScript is having
                                // trouble figuring that out.
                                store,
                            ),
                        ) &&
                        iterableEvery(oldDependencyStores, store => newDependencyStores!.has(store))
                            ? oldDependencyStores
                            : newDependencyStores,

                    parser,
                };
            },
        },

        // Subscribe to all `dependencyStores`. Dispatch a transaction to update our
        // incremental parser whenever a dependency store changes.
        view: view => {
            let cleanupFunctions: Array<() => void> | null = null;

            const cleanup = () => {
                if (cleanupFunctions === null) return;

                const currentCleanupFunctions = cleanupFunctions;
                cleanupFunctions = null;

                for (const cleanupFunction of currentCleanupFunctions) cleanupFunction();
            };

            const update = (view: EditorView, oldState: EditorState | null) => {
                let oldPluginState = oldState
                    ? contentEditorCodeBlockPluginKey.getState(oldState)!
                    : null;
                let newPluginState = contentEditorCodeBlockPluginKey.getState(view.state)!;

                oldPluginState =
                    oldPluginState instanceof Lazy ? oldPluginState.get() : oldPluginState;

                newPluginState =
                    newPluginState instanceof Lazy ? newPluginState.get() : newPluginState;

                if (oldPluginState?.dependencyStores === newPluginState.dependencyStores) return;

                cleanup();
                if (newPluginState.dependencyStores === null) return;

                cleanupFunctions ??= [];

                for (const dependencyStore of newPluginState.dependencyStores) {
                    cleanupFunctions.push(
                        dependencyStore.subscribe(() => {
                            view.dispatch(
                                view.state.tr.setMeta(contentEditorCodeBlockPluginKey, true),
                            );
                        }),
                    );
                }
            };

            update(view, null);

            return {
                update,
                destroy: cleanup,
            };
        },

        props: {
            decorations(state) {
                let pluginState = this.getState(state)!;

                pluginState = pluginState instanceof Lazy ? pluginState.get() : pluginState;

                return pluginState.parser.decorations;
            },
        },

        // When the user deselects a code block line we want to clear any trailing space
        // from the code block line. Like VS Code's trim trailing whitespace on save
        // feature. Except documents aren't saved so we trim when the user leaves a code
        // block line.
        //
        // The user's selection must be entirely in the one code block line and they must
        // fully leave the code block line. The document may change when the selection
        // moves (e.g. hitting enter to add a new line) but the code block line the user is
        // leaving must not change at all to be trimmed.
        //
        // Trimming is best effort. There are definitely scenarios where we won't be able
        // to trim (e.g. user reloads the page so we don't see their selection leave).
        //
        // We are definitely making an assumption here that trailing white space is
        // irrelevant to a code block example and it feels wrong when present (given most
        // code editors trim it). These assumptions may not hold to all our users so we
        // should consider making this configurable.
        appendTransaction: (transactions, oldState, newState) => {
            const oldFromNode = oldState.selection.$from.node();
            if (oldFromNode.type.name !== "codeBlockLine") return;

            const oldToNode = oldState.selection.$to.node();
            if (oldFromNode !== oldToNode) return;

            const oldNode = oldFromNode;

            const oldStartPos = oldState.selection.$from.start();
            const newStartPos = transactions.reduce(
                (startPos, transaction) => transaction.mapping.map(startPos),
                oldStartPos,
            );

            const $newStartPos = newState.doc.resolve(newStartPos);
            const newNode = $newStartPos.node();
            if (!newNode.eq(oldNode)) return;

            const newNodeIndexStack = createArrayWithLength($newStartPos.depth, depth =>
                $newStartPos.index(depth),
            );

            // Make sure the selection moved out of the code block line!
            const newFromNodeIndexStack = createArrayWithLength(
                newState.selection.$from.depth,
                depth => newState.selection.$from.index(depth),
            );
            if (isDeepEqual(newNodeIndexStack, newFromNodeIndexStack)) return;

            // Make sure the selection moved out of the code block line!
            const newToNodeIndexStack = createArrayWithLength(newState.selection.$to.depth, depth =>
                newState.selection.$to.index(depth),
            );
            if (isDeepEqual(newNodeIndexStack, newToNodeIndexStack)) return;

            let trailingSpaceCount = 0;
            for (let i = newNode.childCount - 1; i >= 0; i--) {
                const childNode = newNode.child(i);
                if (!childNode.isText) break;

                const match = childNode.text!.match(/ +$/);
                if (!match) break;

                trailingSpaceCount += match[0].length;
                if (match[0].length < childNode.text!.length) break;
            }

            if (trailingSpaceCount === 0) return;

            const oldNodeEnd = $newStartPos.end();
            return newState.tr.deleteRange(oldNodeEnd - trailingSpaceCount, oldNodeEnd);
        },
    });
}
