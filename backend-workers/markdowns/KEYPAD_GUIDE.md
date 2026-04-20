# TagSakay Device Keypad Guide

This document describes keypad flows and the exact keys to press for common operations (operation mode, override flow, picker navigation).

Keypad layout (4x4):

- Row1: `1 2 3 A`
- Row2: `4 5 6 B`
- Row3: `7 8 9 C`
- Row4: `* 0 # D`

Global keys and meanings

- `A` : Open keypad menu (press again to re-open)
- `*` : Cancel current input / in slot picker cancels override flow
- `#` : Confirm / submit current input or selection
- `B` : In menu: Toggle Operation Mode (queue mode)
- `5` : In menu while Operation Mode is ON: start Override flow

Override flow (operation mode required)

1. Enter menu: press `A` → then press `5` to start override (or select menu item 5).
2. Prompt: `Old ID:` → type the old identifier value using number keys (or unit string) then press `#`.
3. Slot Picker appears on TFT: use navigation keys to choose the exact slot:
   - `4` : move left
   - `6` : move right
   - `2` : move up
   - `8` : move down
   - `#` : confirm selected slot
   - `*` : cancel override and return to ready state
4. Prompt: `New ID:` → type the new identifier, press `#` to submit the replacement for the selected slot.
5. Choose color override (final step): press one of
   - `1` = `RESERVE` (magenta)
   - `2` = `FIX` (amber)
   - `3` = `CLEAR` (clear override / cyan)

Notes and safety

- The picker shows a highlight around the currently selected slot and a footer indicating the slot index and value.
- The slot-specific override performs a safety check: it will only replace the value at the selected slot if it still matches the previously-entered Old ID (protects against race conditions).
- Cancel at any point during the picker with `*` to abort the flow.

Quick sequences

- Start override and replace first slot quickly:

  - `A` → `5` → type old id → `#` → (picker appears) `#` → type new id → `#` → `1` (reserve)

- Cancel slot picker and return:
  - `A` → `5` → type old id → `#` → (picker) `*`

If you want me to include images/screenshots of the TFT screens or export a printable cheat-sheet, I can generate that next.
