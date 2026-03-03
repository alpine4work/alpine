/**
 * Type for describing the various capabilities of the grid view you're working
 * with. Different grid view variants will have different capabilities. Some
 * capabilities are not compatible with others.
 *
 * Capabilities and variants are two different code styles for configuring a
 * component that renders in many different contexts. For variants you enumerate
 * what contexts the component renders in (detail view subtasks, collection view,
 * query view, my tasks view). For capabilities you enumerate the features that
 * change across contexts and let the contexts enable/disable features.
 *
 * Generally I've found capabilities configuration to be cleaner since when writing
 * code that's toggled on a capability you have one boolean to check instead of
 * doing `variant === X || variant === Y`. The interface of the component is more
 * clear.
 */
export type TaskGridViewCapabilities = {
    isReadOnly: boolean;
    hasParentTaskTitle: boolean;
    hasMultilineTitle: boolean;
} & ( // Can't set both `hasDenseFields` and `hasColumns` to true.
    | {
          hasDenseFields: false;
          hasColumns: false;
          withoutAssigneeField: false;
      }
    | {
          hasDenseFields: true;
          hasColumns: false;
          withoutAssigneeField: boolean;
      }
    | {
          hasDenseFields: false;
          hasColumns: true;
          withoutAssigneeField: boolean;
      }
);
