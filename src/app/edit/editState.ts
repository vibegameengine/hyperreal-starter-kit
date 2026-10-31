import type { HostNode } from '../../shared/react/renderer';
import type { GizmoPart, GizmoTool } from './gizmoParts';

export interface AxisTarget {
  level: number;
  prop: string;
  index: number;
  sign: number;
  add?: boolean;
  base?: number[];
}

export interface WholeTarget {
  level: number;
  prop: string;
  add?: boolean;
  base?: number | number[];
}

export interface SourceProp {
  name: string;
  value?: unknown;
  writable: boolean;
  reason?: string;
  fromDefault?: boolean;
}

export interface InspectResult {
  levels: { file: string; line: number; column: number; tag: string; matchesDisk: boolean }[];
  axes: (AxisTarget | null)[];
  rotation: WholeTarget | null;
  scale: WholeTarget | null;
  props: (SourceProp[] | null)[];
  reasons: string[];
}

export interface Selected {
  node: HostNode;
  chain: any[];
  inspected?: InspectResult;
}

export const editState = {
  active: false,
  tool: 'move' as GizmoTool,
  selection: [] as Selected[],
  hoveredPart: undefined as GizmoPart | undefined,
  message: '',
  paused: false,
};

export function report(message: string) {
  editState.message = message;
  console.log(`[edit] ${message}`);
}

export const activeSelected = () => editState.selection.at(-1);
export const isSelected = (node: HostNode) => editState.selection.some((entry) => entry.node === node);
