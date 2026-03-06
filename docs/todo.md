
# Project TODO

This file is a general, prioritized list of tasks and feature notes for the project.


Priority: High
- Add `Edit Movie` modal to pick or create a movie for a staged row.
  - implement efficient provider searching (todo: brainstorm).
  - ensure modal keyboard-accessibility; support arrow navigation and enter-to-select.
- Add ability to swap or choose which provider (TMDb vs IMDb) is used as the staged `titleID`.
- Fix layout shift around Edit Tags button and Tags column.

Priority: Medium
- Add "Add new movie" flow to create a new linked movie entry.

Priority: Low
- Prevent layout shift when editing a rating in a sorted table.  Ratings are now only committed on blur/enter so the row doesn't jump while clicking the number input arrows.
