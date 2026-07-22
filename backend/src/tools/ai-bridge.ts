import { list, execute } from './registry.js';
import type { ToolContext } from './base.js';

export function toolsToFunctionSchemas() {
  return list().map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  }));
}
