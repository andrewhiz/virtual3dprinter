import { COREXY } from './corexy';
import { DELTA } from './delta';
import { SLINGER } from './slinger';
import type { PrinterId, PrinterSpec } from './types';

export const PRINTERS: PrinterSpec[] = [SLINGER, COREXY, DELTA];

export function printerById(id: string | null): PrinterSpec | undefined {
  return PRINTERS.find((p) => p.id === (id as PrinterId));
}

export type { ControlAction, PanelState, PrinterRig, PrinterSpec } from './types';
