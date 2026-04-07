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
    /**
     * Are all the rows in this grid view read-only because the user doesn't have edit
     * access to the grid view?
     *
     * In some cases, individual rows may be read-only while the rest of the grid is
     * editable. For example, `<TaskQueryView>`. Where there may be tasks in a
     * collection you have only have view permission for mixed with tasks in a
     * collection you have edit permission for.
     */
    isReadOnly: boolean;

    /**
     * Does this grid view render parent task titles for subtasks? True basically
     * everywhere except `<TaskDetailView>` where the tasks are implicitly subtasks of
     * the `<TaskDetailView>`.
     */
    hasParentTaskTitle: boolean;

    /**
     * Should the task title wrap onto multiple lines?
     */
    hasMultilineTitle: boolean;

    /**
     * If you open the collection field in a ghost task in this row and create a
     * collection inline (which also serves to create the ghost task) then is the
     * created collection private?
     */
    isCreatedCollectionFromGhostTaskPrivate: boolean;
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
