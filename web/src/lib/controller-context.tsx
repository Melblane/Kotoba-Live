import { createContext, useContext, useSyncExternalStore } from 'react';
import type { TranslatorController, ControllerState } from './controller';

export const ControllerContext = createContext<TranslatorController | null>(null);

export function useController(): TranslatorController {
  const c = useContext(ControllerContext);
  if (!c) throw new Error('ControllerContext is missing');
  return c;
}

export function useControllerState(): ControllerState {
  const c = useController();
  return useSyncExternalStore(c.subscribe, c.getState);
}
