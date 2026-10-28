export interface CancelableUiState {
  tool: string | null;
  rightPanel: string | null;
  building: number | null;
  clearing: number | null;
  site: string | null;
}

export const cancelUiState = (state: CancelableUiState, dialogOpen: boolean): CancelableUiState =>
  dialogOpen ? state : { tool: null, rightPanel: null, building: null, clearing: null, site: null };

export const shouldRepeatTool = (button: number, currentTool: string | null, lastTool: string | null): boolean =>
  button === 1 && currentTool === null && lastTool !== null;
