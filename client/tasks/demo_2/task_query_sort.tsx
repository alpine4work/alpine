export type TaskQuerySort =
    | {
          readonly type: "Status";
          readonly direction: "Ascending" | "Descending";
      }
    | {
          readonly type: "Assignee";
          readonly noAccountSide: "Start" | "End";
      }
    | {
          readonly type: "Creator";
      }
    | {
          readonly type: "Assigner";
          readonly noAccountSide: "Start" | "End";
      }
    | {
          readonly type: "DueDate";
          readonly direction: "Ascending" | "Descending";
      }
    | {
          readonly type: "CreatedDate";
          readonly direction: "Ascending" | "Descending";
      }
    | {
          readonly type: "AssignedDate";
          readonly direction: "Ascending" | "Descending";
      }
    | {
          readonly type: "ClosedDate";
          readonly direction: "Ascending" | "Descending";
      }
    | {
          readonly type: "ActivatedDate";
          readonly direction: "Ascending" | "Descending";
      };
