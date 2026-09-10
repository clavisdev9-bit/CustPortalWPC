# Prompt — Shipment Tracking Interactive Prototype

Use this prompt together with the existing static design ("Portway Shipment Tracking" canvas: Shipment Tracking List + Shipment Detail) as the visual reference. The goal is to turn that static mockup into a clickable, stateful prototype — same design system, same sample data, but with working interactions instead of a flat picture.

## Objective

Build an interactive prototype of the Freight Forwarding "Shipment Tracking" feature (List view + Detail view) that a stakeholder can click through end-to-end without a real backend. Reuse the existing visual language exactly: dark navy header (#0B1B33), blue accent (#2F6FED), semantic status colors (blue = In Transit, green = Delivered, orange = Arriving Soon, red = Delayed, gray = Cancelled), IBM Plex Sans / IBM Plex Mono typography, white cards on #F7F9FC background, 8-row sample shipment dataset already defined in the static version.

## Required interactions

**Search & filter panel**
- Typing in Shipment ID / Container Number / B/L / Booking Number and pressing "Search" filters the table to matching rows (client-side match against the mock dataset).
- "Advanced Filter" opens a filter drawer/panel (Mode, Status, Origin, Destination, Date range) with a "Reset" that clears all active filters back to the full list.
- Active filters show as removable chips above the table.

**Summary cards**
- Clicking a KPI card (In Transit / Arriving Soon / Delivered / Delayed) filters the table to that status and visually marks the card as active (e.g. border + tint).
- Clicking "Total Shipments" clears the status filter.

**Shipment table**
- Clicking a column header (Shipment ID, ETD, ETA, Status, etc.) toggles sort ascending/descending with the arrow icon reflecting current sort state.
- The toolbar search box filters visible rows live as the user types (debounced).
- "Mode" and "Status" filter dropdowns narrow the table instantly on selection.
- Clicking a row (or its "view" icon) navigates to the Shipment Detail view for that shipment, without a full page reload — pass the shipment id as state/route param.
- "Customize columns" opens a checklist popover to show/hide columns; hidden columns disappear from the table immediately.
- "Export" shows a brief confirmation toast ("Exporting 8 shipments to Excel...").
- Pagination buttons change the visible page; first/prev disabled on page 1, next/last disabled on the final page.

**Shipment Detail view**
- Breadcrumb "Shipment Tracking" navigates back to the list, ideally preserving whatever filters/sort/page were active before.
- Each timeline milestone is hoverable/clickable to reveal its full note in a tooltip or expanded row if truncated.
- Map markers (origin, transshipment, current position, destination) show a tooltip with full location name and timestamp on hover.
- "Download" on an available document triggers a mock download toast; documents marked "Not yet available" are disabled (no click action, cursor not-allowed).
- "Share" opens a small dropdown/modal with a mock shareable link and a "Copy link" button that shows a "Copied" confirmation.

**Global states to include**
- Loading skeleton rows while a search/filter is "applying" (short simulated delay is fine).
- Empty state when a search/filter matches nothing ("No shipments match your filters" + a "Clear filters" action).
- Toast/snackbar pattern reused for export, download, share, and copy-link confirmations.
- Visible hover, focus (keyboard-navigable), and active/pressed states on every interactive element — buttons, rows, chips, pagination, tabs.

## Data

Reuse the 8 sample shipments already defined (SHP-2026-04831 through SHP-2026-04430) and their statuses/dates exactly as in the static version, so List and Detail stay consistent. No real API calls — all interactions run against this in-memory mock dataset.

## Deliverable

A clickable prototype (HTML/CSS/JS, or a Figma prototype with connected frames) that lets a reviewer: search or filter the list → sort it → click into a shipment's detail → explore its timeline, map, and documents → navigate back — entirely through real UI interaction, not static screenshots.

## Non-goals

No authentication, no real backend/API integration, no Vessel Schedule or Airline Schedule interactivity yet (those follow the same pattern once this one is validated).
