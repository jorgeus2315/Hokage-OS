export interface EtsyListingInput {
  query?: string;
  limit?: number;
}

export interface EtsyListingOutput {
  total: number;
  items: Array<{
    id: string;
    title: string;
    price: number;
    currency: string;
    url?: string;
  }>;
}

export interface ShopifyListingInput {
  query?: string;
  limit?: number;
}

export interface ShopifyListingOutput {
  total: number;
  items: Array<{
    id: string;
    title: string;
    price: number;
    currency: string;
    url?: string;
  }>;
}

export interface PrintifyProductInput {
  query?: string;
  limit?: number;
}

export interface PrintifyProductOutput {
  total: number;
  items: Array<{
    id: string;
    title: string;
    variants: number;
    basePrice: number;
    currency: string;
  }>;
}

export interface GoogleTrendsInput {
  query: string;
  region?: string;
  timeframe?: '7d' | '30d' | '90d';
}

export interface GoogleTrendsOutput {
  query: string;
  region: string;
  timeframe: string;
  interest: Array<{
    date: string;
    value: number;
  }>;
  rising: Array<{
    query: string;
    value: number;
  }>;
}

export interface WebBrowserInput {
  url: string;
  maxChars?: number;
}

export interface WebBrowserOutput {
  url: string;
  title?: string;
  content: string;
  truncated: boolean;
}

export interface SystemExecInput {
  command: string;
  cwd?: string;
  reason?: string;
}

export interface SystemExecOutput {
  status: 'pending_approval';
  execRunId: number;
}

// Fase 1 de la migración marcadores → Tool Calling (HOKAGE_CORE_SPECIFICATION_v1.md §2)
export interface TrendReportInput {
  keyword: string;
  description: string;
}

export interface TrendReportOutput {
  marketId: number;
  keyword: string;
}
