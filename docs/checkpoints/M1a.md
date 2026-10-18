# Checkpoint — M1a (board)

**Date:** 2026-10-18 · **Tickets:** M1-01 … M1-12 · **Decisions:** [ADR-001, 002, 003](../decisions.md)

## Demo — steps 2–5 of the [M1 demo script](../specs/M1-solo-board.md#9-demo-script)

Recorded with Playwright against the production build (screen capture: [demo-steps-2-5.webm](M1a/demo-steps-2-5.webm)).

| Step | Result |
|---|---|
| 2. Add Client, Load Balancer, API, Database, and a Custom node "Stripe" | ✅ Custom opens straight into naming |
| 3. Rename API → "Orders API"; connect Client→LB→API→Database and API→Stripe | ✅ |
| 4. API→API and a duplicate edge are refused | ✅ refused while dragging (`canConnect`) and again in the store |
| 5. Delete Stripe: its edge disappears too | ✅ one store update, no error |

| Nodes | Connected | After deleting Stripe |
|---|---|---|
| ![nodes](M1a/1-nodes.png) | ![connected](M1a/2-connected.png) | ![after delete](M1a/3-after-delete.png) |

The same flows run on every PR in `apps/web/e2e/board-editing.spec.ts`.

**Seen in the demo:** arrows between nodes that sit close together are barely visible (thin grey line, small arrowhead). Worth a styling pass before the M1 demo video.

## Structure review — did modules/pods help or slow you down?

*Your call — answer in your own words. Facts from building M1a to help:*

- **Helped:**
  - Each pod stayed small: canvas, toolbar and node each have their own tests.
  - Lint caught wrong imports between pods.
  - Moving `kindAppearance` and `flowTypes` up to module level ("promotion on 2nd use") was a one-file move each time.
- **Cost:**
  - Two pods cooperating (toolbar → node: "edit this new Custom node") needed shared state in the module store (`editingNodeId`).
  - React Flow renders node components itself, so they needed a context (`BoardStoreContext`) to reach the store.
  - Deep relative imports (`../../../../../core/ui`).
- **Candidates to simplify before M1b:**
  - A path alias for `core` (`@/core/ui`) to replace the deep relative imports?
  - Anything else you felt was in the way?

**Your verdict:** _…_

## UX pass after the diagram package

**Date:** 2026-10-18 · walked every journey at 1280×800, at phone size (390×844) and with the keyboard.

**Works well:** shapes per kind read like an architecture diagram; arrows route at right angles around boxes; renaming, Custom naming and deleting all feel direct.

| # | Finding | Severity | Ticket |
|---|---|---|---|
| 1 | On a phone the canvas is gone: the assistant panel takes the whole width | High | M1-UX1 |
| 2 | Toolbar icons have no visible names (Globe = CDN? Network = load balancer?) | High | M1-UX1 |
| 3 | New nodes pile up 24 px apart; every one has to be dragged out | Medium | M1-UX1 |
| 4 | Empty board: no hint of what to do | Medium | M1-UX1 |
| 5 | Boxes slightly misaligned give arrows small jogs | Low | M1-UX1 (snap to grid) |
| 6 | Minimap is an empty white box on a small board | Low | M1-UX1 |
| 7 | Dragging an arrow onto a box it can't connect to: no feedback | Low | M1-UX1 |
| 8 | No visible way to delete (keyboard only) | Low | later |
| 9 | Toolbar is 10 tab stops (no arrow keys) | Low | A5 |

### Journeys after M1-UX1 (2026-10-18)

Tested by hand in the browser (clicks, typing, keyboard) and with Playwright driving a real mouse for drags. Target: **desktop**.

| # | Journey | Result |
|---|---|---|
| 1 | Open the app | ✅ empty board says how to start |
| 2 | Add each of the 10 kinds | ✅ named buttons; boxes land in free, visible slots, on the grid |
| 3 | Name a Custom box | ✅ opens in edit mode · ⚠️ typing *instantly* after the click can lose the first letters (editor opens one frame later) |
| 4 | Rename (double-click, or Enter on a focused box) | ✅ |
| 5 | Move a box | ✅ snaps to a 20 px grid, arrows follow |
| 6 | Connect two boxes | ✅ hint until the first arrow; right-angle routes around boxes |
| 7 | Refused arrow (to itself, duplicate) | ✅ the line turns red; nothing is added |
| 8 | Delete a box (with its arrows) / an arrow | ✅ Delete or Backspace · ⚠️ no visible delete action yet |
| 9 | Pan, zoom, fit view | ✅ |
| 10 | Keyboard only | ✅ toolbar first in Tab order, Enter renames, Delete deletes · ⚠️ toolbar is 10 tab stops; arrows can't be drawn by keyboard (A5) |
| 11 | AI proposal: ghosts, Accept/Reject | ⏳ not testable yet: there is no chat until M1b |
| 12 | Phone | Not a target: only "not broken" (stacked layout) |
