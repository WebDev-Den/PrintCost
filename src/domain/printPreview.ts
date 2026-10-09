export interface PrintPreviewGroup {
  trayId: number;
  colorHex: string;
  positions: Float32Array;
}

export interface PrintPreviewPlate {
  plateIndex: number;
  plateName: string;
  groups: PrintPreviewGroup[];
  warnings: string[];
  unavailableReason?: string;
}

export interface PrintPreviewData {
  plates: PrintPreviewPlate[];
  warnings: string[];
}
