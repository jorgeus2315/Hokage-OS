export interface Vec2 {
  x: number;
  y: number;
}

export interface WorldNode {
  id: string;
  pos: Vec2;
  target: Vec2;
  color: number;
  label: string;
}

export interface HubDescriptor {
  label: string;
  sublabel: string;
  onClick: () => void;
}

export interface RoomDescriptor {
  id: string;
  x: number; // % 0-100 dentro de la escena
  y: number;
  label: string;
  sublabel: string;
  pending: boolean;
  onClick: () => void;
}

export interface TokenDescriptor {
  id: string;
  x: number; // % objetivo — el motor interpola el movimiento real
  y: number;
  label: string;
  working: boolean;
  onClick?: () => void;
}
