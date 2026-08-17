import type { ReactNode } from 'react';

// Mismo patrón que VisualKindRegistry del ECS (world/registries/VisualKindRegistry.ts):
// el motor (aquí, GameLayout.tsx) no conoce qué pantallas existen — solo pide "la
// definición de esta clave" y monta lo que le devuelva. Añadir un overlay nuevo es
// una entrada de registro más, nunca una rama condicional nueva en el JSX.
// Fase 4 de UI Implementation Plan.md: solo describe qué se monta — el estado
// (qué overlay está abierto) sigue siendo React local hasta la Fase 5.

export type PanelPosition = 'overlay' | 'left' | 'right' | 'bottom-left' | 'bottom-right' | 'building';

export interface PanelDefinition {
  title: string;
  position?: PanelPosition; // Opcional para overlays (pantallas completas)
  render: (ctx: PanelContext) => ReactNode;
  // Si true, el panel se cierra al navegar al mapa (comportamiento de overlays actuales)
  dismissOnMap?: boolean;
}

export interface PanelContext {
  // Datos que GameLayout ya tiene y los paneles pueden necesitar
  agents: any[];
  ventures: any[];
  runs: any[];
  messages: any[];
  liveEvents: any[];
  departments: any[];
  objectives: any[];
  metrics: any;
  runtimeOn: boolean;
  wsConnected: boolean;
  clock: string;
  pending: any[];
  activeBuilding: any;
  buildingAgent: any;
  pendingForAgent: any[];
  section: any;
  chatByAgent: any;
  chatInput: string;
  chatLoading: boolean;
  onChangeSection: (s: any) => void;
  onChangeChatInput: (v: string) => void;
  onSendChat: () => Promise<void>;
  onApprove: (id: number) => Promise<void>;
  onReject: (id: number) => Promise<void>;
  onRunNow: () => Promise<void>;
  onAgentUpdated: () => void;
  reload: any;
  setScreen: (s: any) => void;
  setShowMenu: (v: boolean) => void;
  setActiveBuilding: (b: any) => void;
  setSection: (s: any) => void;
  setChatByAgent: (c: any) => void;
  setChatInput: (v: string) => void;
  setChatLoading: (v: boolean) => void;
  enterBuilding: (b: any) => void;
  approve: (id: number) => Promise<void>;
  reject: (id: number) => Promise<void>;
  expireAll: () => Promise<void>;
  toggleRuntime: () => Promise<void>;
  runNow: () => Promise<void>;
  sendChat: () => Promise<void>;
  showToast: (m: string) => void;
  roleColors: Record<string, string>;
}

export class PanelRegistry<K extends string> {
  private panels = new Map<K, PanelDefinition>();

  register(key: K, def: PanelDefinition): void {
    this.panels.set(key, def);
  }

  get(key: K): PanelDefinition | undefined {
    return this.panels.get(key);
  }

  getAll(): PanelDefinition[] {
    return Array.from(this.panels.values());
  }

  getByPosition(position: PanelPosition): PanelDefinition[] {
    return this.getAll().filter((p) => p.position === position);
  }
}

// Registro global único para paneles de UI (no del ECS/World)
// Se instancia en GameLayout.tsx y se puebla con register() antes del render
export const panelRegistry = new PanelRegistry<string>();