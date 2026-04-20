# Driver View UX & Accessibility Audit

_Last updated: 2025-11-21_

## Scope

Reviewed the driver-specific experience rendered inside `frontend/src/views/Dashboard.vue` (cards + history list) for layout, touch ergonomics, and accessibility compliance.

## Findings

1. **Non-interactive stats cards lack semantics**  
   The metric cards in the "Driver Statistics" grid are plain `<div>` blocks without `role="group"`, `aria-label`, or keyboard focus handling. Screen readers only announce the raw numbers without any context, and keyboard users cannot discover the metric descriptions. (Lines ~210–280.)

2. **Status colors carry meaning without text alternatives**  
   The scan history rows rely on border/background colors to convey success/failed/unauthorized states. Although a status label exists, its color contrast (`text-warning` / `text-error` using Tailwind defaults) falls below WCAG AA on the base background. (Lines ~360–420.)

3. **Scroll container lacks affordances**  
   The scan history area uses `max-h-96` with `overflow-y-auto` but omits `aria-live` or sticky headers. Keyboard users have no obvious way to navigate long histories, and the scroll region is not identified to assistive tech. (Lines ~350–420.)

4. **Touch targets are tight**  
   Driver-only actions such as switching between 7/30-day stats are absent; instead, the entire cards are static. The list items have 12px vertical padding, which makes tapping individual rows on a phone difficult. (Lines ~210–340.)

5. **Missing empty-state guidance**  
   When the driver has no associated RFID tags, the UI simply renders "No scan records found" without prompting them to contact an admin or register a tag. That leaves drivers without clear next steps. (Lines ~330–360.)

## Recommended remediation (to implement next)

1. Wrap each metric card in a focusable container (`tabindex="0"`, `role="group"`) and announce the metric via `aria-labelledby`/`aria-describedby` so SR users hear both the label and time span.
2. Replace Tailwind's default semantic colors with WCAG-compliant tokens (e.g., `text-success-content`) and add inline status text + icons to avoid color-only cues.
3. Convert the scan history list into a semantic `<ul>` or data table with column headers (`aria-label="Scan history"`). Add `aria-live="polite"` if we later stream updates.
4. Increase row padding to at least `py-4` and add a quick-filter pill group ("All", "Success", "Failed") to reduce scroll fatigue.
5. Extend the empty state message with actionable guidance (link to RFID registration page or support contact) and add a CTA button with `aria-label="Request RFID registration"`.

These adjustments will be folded into the upcoming Driver UX implementation task.

## Validation checklist (2025-11-21)

1. **Keyboard-only pass** – With `npm run dev` running, open `/dashboard` as a driver and press `Tab` from the header. Confirm focus order: cards → status filter buttons → scan list items. Each card should show a focus ring and announce its label.
2. **Screen reader smoke test** – Enable NVDA/VoiceOver and read the scan history region. Ensure it announces "Driver scan history" and each list item states tag, status badge, and timestamp. Listen for the empty state instructions when no scans exist.
3. **Color contrast** – Use Chrome DevTools' contrast checker on the new status pills (`border-*` + base text). All pass AA on the `bg-base-100` background (>4.5:1). Document any themes that fail.
4. **Touch targets** – Emulate a mobile viewport (Chrome DevTools) and verify row padding (`p-4`) leaves ≥44px height. Filters should be tappable without zoom.
5. **Accessibility risks** – Remaining gap: the scan history still relies on manual refresh (no live updates), so we skipped `aria-live`. Revisit once live data streaming is reintroduced.
