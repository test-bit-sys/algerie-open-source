# Quick-add bar with natural-language dates

Labels: enhancement, ui, capture
Priority: P2
Status: Implemented

## Problem

Adding a task always means opening the full modal (`openTaskForm`,
`src/ui/taskform.js`) and walking a date picker, a time picker, a
priority segment, and a repeat dropdown. That's the right tool for
*editing*, but capture speed is the core loop of a to-do app: the cost of
writing something down decides whether it gets written down. Typing
"pay rent friday 9am" should be one line and Enter, not five controls.

## Proposal

- An inline quick-add input at the top of Today and list detail views
  (and opened by the existing `n` shortcut), where a single line is parsed
  as it's typed:
  - dates: `today`, `tomorrow`, `mon`/`next monday`, `aug 12`, `12.8.`
  - times: `9am`, `15:30`
  - recurrence: `every day`, `every 2 weeks`, `every mon,wed` — mapped
    onto the existing rule shape in `src/lib/recur.js`
  - priority: `!high` / `!1`–`!3`
  - list: `#work` (matches list names; defaults to the current list or
    `defaultListId`)
- Parsed fragments render as removable chips under the input so the user
  sees exactly what will be set before pressing Enter; a mis-parse is one
  tap to dismiss. Text in chips is stripped from the title.
- Enter adds the task and keeps focus in the input for rapid entry of
  several tasks; the full form stays one tap away ("More options").
- Parser lives in a new `src/lib/quickparse.js` with unit tests alongside
  the existing `tests/recur.test.js` — it's pure string→draft logic.

## Acceptance criteria

- "call mom tomorrow 6pm !high" creates a task titled "call mom" with the
  right due date, time, and priority, without opening the modal.
- "water plants every 3 days" produces the same rule the repeat picker
  would.
- Unrecognized text is never silently dropped — it stays in the title.
- Works with the keyboard only; chips are announced to screen readers.
- Date words respect the user's week-start setting where relevant.

## Out of scope

- Full natural-language processing or multi-language parsing (English
  keywords first; the date picker remains for everything else).
