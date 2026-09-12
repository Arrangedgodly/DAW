/** The visible control that switches between notes and arrangement.
 * Desktop uses an explicit destination tab; phone uses one toggle button.
 */
export const WORKSPACE_TOGGLE = [
  ".phone-page-toggle",
  '.app[data-page="song"] .desktop-page-nav [data-page="edit"]',
  '.app:not([data-page="song"]) .desktop-page-nav [data-page="song"]',
].join(", ");
