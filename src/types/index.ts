// Types for Options Strategy Simulator

// Option Types
export type OptionType = 'call' | 'put';
export type PositionDirection = 'long' | 'short';

// Option Position
export interface OptionLeg {
  id: string;
  type: OptionType;
  direction: PositionDirection;
  strike: number;
  expiry: string;
  quantity: number;
  premium: number;
  iv: number;
}

// Strategy
export interface Strategy {
  id: string;
  name: string;
  underlying: string;
  underlyingPrice: number;
  legs: OptionLeg[];
  createdAt: Date;
}

// Greeks
export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho?: number;
}

// Option Chain Data
export interface OptionChainRow {
  strike: number;
  callBid: number;
  callAsk: number;
  callMark: number;
  callVolume: number;
  callOI: number;
  callIV: number;
  callDelta: number;
  putBid: number;
  putAsk: number;
  putMark: number;
  putVolume: number;
  putOI: number;
  putIV: number;
  putDelta: number;
}

export interface OptionChain {
  underlying: string;
  underlyingPrice: number;
  expiry: string;
  expiryDays: number;
  data: OptionChainRow[];
}

// Payoff Calculation
export interface PayoffPoint {
  price: number;
  payoff: number;
  t0Value: number;
}

// Market Data
export interface MarketData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  timestamp: Date;
}

// Widget Types
export type WidgetType =
  | 'option-chain'
  | 'strategy-builder'
  | 'payoff-chart'
  | 'greeks-viz'
  | 'simulation-control'
  | 'option-filter'
  | 'black-scholes'
  | 'position-simulator'
  | 'index-price'
  | 'strategy-presets'
  | 'market-screener'
  | 'market-ticker'
  | 'price-chart';

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  data?: unknown;
  [key: string]: unknown; // Index signature for React Flow compatibility
}

// Dashboard Layout
export interface DashboardNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: WidgetConfig;
}

export interface DashboardEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface Workspace {
  id: string;
  name: string;
  nodes: DashboardNode[];
  edges: DashboardEdge[];
  createdAt: Date;
  updatedAt: Date;
}
