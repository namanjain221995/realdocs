import { createContext } from 'react';

/**
 * True below a `Toolbar`. Composite controls placed in a toolbar (a segmented
 * control, say) then leave arrow keys and tab stops to the toolbar.
 */
export const ToolbarContext = createContext(false);
