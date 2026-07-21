import type { Tool } from './base.js';
import { EtsyTool } from './etsy.js';
import { PrintifyTool } from './printify.js';
import { GoogleTrendsTool } from './google-trends.js';
import { WebBrowserTool } from './web-browser.js';

export const registry: Tool[] = [
  EtsyTool,
  PrintifyTool,
  GoogleTrendsTool,
  WebBrowserTool,
];
