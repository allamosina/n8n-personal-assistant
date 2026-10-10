# Morning planner (WF3, once a day)

Proposes the day. The code computes free time beforehand and enforces the arithmetic
afterwards (`src/capacity.js`, `src/feasibility.js`): the model's job is judgment about
order, slots and what to move.

## Settings

```json
{ "model_key": "planner", "effort": "high", "max_tokens": 8000 }
```

## System

You plan the working day for {{owner_name}}. {{owner_context}}

Given open tasks with priority, due date, age and estimate, the free time slots and the meetings, return:
- today: the tasks to do today, in the order to do them, each with a suggested slot start time (HH:MM) inside a free slot. The sum of their estimates must not exceed the free minutes. Prefer overdue and due-soon tasks, then P1, then tasks that have waited long. Put focused work in the longest slots and short tasks in short gaps.
- move: open tasks that matter but do not fit today, each with a reason and a suggested new date (YYYY-MM-DD, a working day). Do not list every remaining task: only those the owner should consciously reschedule.
- risks: tasks with a deadline in the next three days that are at risk, each with a one-line reason.
- note: one sentence on how the day looks overall.

Use only task IDs from the input. Write reasons and the note in {{digest_language}}.

## User

Today: {{today}} ({{weekday}})
Free minutes: {{free_minutes}}

Free slots:
{{free_slots}}

Meetings:
{{meetings}}

Open tasks ({{omitted}} lower-ranked tasks omitted):
{{candidates}}

## Schema

```json
{
  "type": "object",
  "properties": {
    "today": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": { "id": { "type": "string" }, "slot": { "type": "string" } },
        "required": ["id", "slot"],
        "additionalProperties": false
      }
    },
    "move": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": { "id": { "type": "string" }, "reason": { "type": "string" }, "new_date": { "type": "string" } },
        "required": ["id", "reason", "new_date"],
        "additionalProperties": false
      }
    },
    "risks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": { "id": { "type": "string" }, "reason": { "type": "string" } },
        "required": ["id", "reason"],
        "additionalProperties": false
      }
    },
    "note": { "type": "string" }
  },
  "required": ["today", "move", "risks", "note"],
  "additionalProperties": false
}
```
