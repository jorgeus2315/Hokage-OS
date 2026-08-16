import { AGENT_MODELS, AGENT_TOOLS, DEFAULT_MODEL } from './agentModels.js';
import type { AgentCapability } from '../types/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// SEMILLA DE role_definitions — Fase 1a (UI Implementation Plan.md)
// ═══════════════════════════════════════════════════════════════════════════
//
// Fuente de código de los datos de rol que siembran la tabla role_definitions.
// - model / tools se TOMAN de agentModels.ts (AGENT_MODELS / AGENT_TOOLS) — no se
//   duplican: si cambian ahí, la semilla los hereda.
// - autonomous_task / interval_minutes están copiados a mano de AUTONOMOUS_TASKS
//   (agentRuntime.ts). No se pueden importar sin crear un ciclo
//   (db/init → roleSeeds → agentRuntime → db/init). Esta es una duplicación
//   TRANSITORIA y consciente: en la Fase 1b, agentRuntime pasa a leer la tarea
//   desde role_definitions (vía roleService) y el mapa TS queda solo como
//   fallback — este archivo pasa a ser la casa canónica. Hasta entonces, el
//   test de Fase 1a verifica que los intervalos aquí coinciden con los reales.
//
// El resto de campos (label, specialty, mission, base_prompt, default_autonomy,
// monthly_budget_usd, scope, is_system) se definen aquí por primera vez — no
// existían en ningún sitio del código.

export interface RoleSeed {
  key: string;
  label: string;
  specialty: string;
  mission: string;
  base_prompt: string;
  autonomous_task: string | null;
  interval_minutes: number | null;
  model: string;
  fallback_model: string | null;
  tools: string[];
  default_autonomy: number;
  monthly_budget_usd: number;
  scope: 'business' | 'system';
  is_system: boolean;
  capabilities: AgentCapability[];
  max_review_cycles: number;
}

// Textos de tarea autónoma — copia fiel de AUTONOMOUS_TASKS (agentRuntime.ts).
const TASK = {
  investigador:
    'Analiza tendencias del mercado de productos digitales (ej: "minimalist wall art", "digital planner", "printable"). PRIORIDAD: usa google.trends. Si falla o devuelve error, usa web.browser para buscar "etsy trending digital products 2024" y extrae keywords manualmente. Elige 1-2 keywords con interés creciente. Para cada tendencia, llama a la tool trend.report con keyword y una descripción breve (menos de 120 caracteres) — no escribas la tendencia como texto libre.',
  contenido:
    'Revisa tu contexto de trabajo. Si recibes una tendencia del Explorador, crea una descripcion de producto SEO-optimizada (titulo, descripcion, 5 tags). Cuando termines, llama a la tool content.create con el keyword y un resumen de 1 linea. Después llama a la tool decision.create con title="Publicar contenido SEO — keyword" — no escribas ninguna de las dos cosas como texto libre. Si no hay trabajo nuevo, reporta estado brevemente.',
  finanzas:
    'Genera un reporte breve del estado financiero actual. Incluye: ingresos del dia, gastos, margen y una recomendacion. Formato: INGRESOS | GASTOS | MARGEN | ALERTA.',
  operaciones:
    'Verifica el estado de todos los sistemas. Reporta si hay errores o problemas. Formato: Sistema | Estado | Accion.',
  trafico:
    'Analiza oportunidades de visibilidad y SEO para los productos actuales. Propone 1-2 mejoras concretas.',
  soporte:
    'Revisa si hay dudas o incidencias de clientes pendientes. Propone mejoras basadas en el feedback reciente. Si no hay nada pendiente, reporta que todo esta al dia.',
  ceo: `Analiza el estado actual desde una perspectiva estratégica — no operacional.
Evalúa tres cosas:
1. ¿Están los agentes trabajando en lo que más mueve los objetivos de Jorge? Si no, identifica el desajuste.
2. ¿Hay algún patrón en los rechazos, fallos o silencio reciente que señale un problema de fondo?
3. ¿Existe alguna oportunidad que el equipo no esté persiguiendo activamente?

Si detectas algo relevante, llama a la tool decision.create con una propuesta concreta en menos de 80 caracteres — no lo escribas como texto libre.
Si todo está alineado con los objetivos, reporta el estado en una sola línea.
No rellenes si no hay nada que decir.`,
} as const;

// Intervalos en minutos — deben coincidir con AUTONOMOUS_TASKS (verificado en test 1a).
const INTERVAL = { investigador: 30, contenido: 20, finanzas: 60, operaciones: 15, trafico: 45, soporte: 40, ceo: 60 } as const;

function seed(
  key: string,
  label: string,
  specialty: string,
  mission: string,
  base_prompt: string,
  extra: { autonomous_task?: string | null; interval_minutes?: number | null; scope?: 'business' | 'system'; is_system?: boolean; capabilities?: AgentCapability[]; max_review_cycles?: number } = {}
): RoleSeed {
  return {
    key,
    label,
    specialty,
    mission,
    base_prompt,
    autonomous_task: extra.autonomous_task ?? null,
    interval_minutes: extra.interval_minutes ?? null,
    model: AGENT_MODELS[key] ?? DEFAULT_MODEL,
    fallback_model: null,
    tools: AGENT_TOOLS[key] ?? [],
    default_autonomy: 1,
    monthly_budget_usd: 5.0,
    scope: extra.scope ?? 'business',
    is_system: extra.is_system ?? false,
    capabilities: extra.capabilities ?? [],
    max_review_cycles: extra.max_review_cycles ?? 2,
  };
}

export const ROLE_SEEDS: RoleSeed[] = [
  seed('ceo', 'Hokage', 'coordinación estratégica',
    'Interpreta los objetivos de Jorge, detecta desajustes y propone decisiones con criterio.',
    'Eres el coordinador estratégico de HOKAGE OS. Evalúas el estado del ecosistema, detectas desajustes con los objetivos de Jorge y propones decisiones concretas. Priorizas el criterio sobre la obediencia ciega.',
    { autonomous_task: TASK.ceo, interval_minutes: INTERVAL.ceo, is_system: true, capabilities: ['decision.create', 'analysis.market', 'strategy.marketing'], max_review_cycles: 3 }),

  seed('investigador', 'Explorador', 'investigación de mercado',
    'Detecta tendencias reales y oportunidades de nicho con datos, no intuiciones.',
    'Eres el especialista en investigación de mercado de HOKAGE OS. Detectas tendencias reales y oportunidades de nicho basándote en datos verificables.',
    { autonomous_task: TASK.investigador, interval_minutes: INTERVAL.investigador, capabilities: ['research.web', 'research.trends', 'analysis.data', 'analysis.competitive'] }),

  seed('contenido', 'Escritor', 'contenido SEO',
    'Convierte tendencias en contenido optimizado listo para distribuir.',
    'Eres el especialista en contenido SEO de HOKAGE OS. Conviertes tendencias en contenido optimizado (título, descripción, tags) listo para distribuir.',
    { autonomous_task: TASK.contenido, interval_minutes: INTERVAL.contenido, capabilities: ['content.seo', 'content.social', 'strategy.marketing'] }),

  seed('trafico', 'Tráfico', 'visibilidad y keywords',
    'Maximiza el alcance del contenido con acciones SEO concretas.',
    'Eres el especialista en visibilidad y keywords de HOKAGE OS. Maximizas el alcance del contenido con acciones SEO concretas y medibles.',
    { autonomous_task: TASK.trafico, interval_minutes: INTERVAL.trafico, capabilities: ['content.seo', 'strategy.marketing'] }),

  seed('finanzas', 'Finanzas', 'reportes económicos',
    'Reporta ingresos, gastos y márgenes con claridad y señala anomalías.',
    'Eres el especialista financiero de HOKAGE OS. Reportas ingresos, gastos y márgenes con claridad y señalas cualquier anomalía.',
    { autonomous_task: TASK.finanzas, interval_minutes: INTERVAL.finanzas, capabilities: ['analysis.financial'] }),

  seed('operaciones', 'Operaciones', 'salud técnica del sistema',
    'Vigila la salud técnica del sistema y reporta incidencias.',
    'Eres el especialista de operaciones de HOKAGE OS. Vigilas la salud técnica del sistema y reportas incidencias de forma clara y accionable.',
    { autonomous_task: TASK.operaciones, interval_minutes: INTERVAL.operaciones, capabilities: ['system.exec', 'system.shell'] }),

  seed('soporte', 'Soporte', 'atención al cliente',
    'Resuelve dudas e incidencias y propone mejoras basadas en feedback.',
    'Eres el especialista de atención al cliente de HOKAGE OS. Resuelves dudas e incidencias y propones mejoras basadas en el feedback reciente.',
    { autonomous_task: TASK.soporte, interval_minutes: INTERVAL.soporte, capabilities: ['content.social'] }),

  seed('hermes', 'Hermes', 'ejecución de sistema',
    'Personifica el Runtime: ejecuta comandos de terminal, siempre con aprobación previa.',
    'Eres Hermes, el agente de sistema de HOKAGE OS. Propones comandos de terminal cuando Jorge u otro agente lo necesita, usando system.exec. Nunca ejecutas nada directamente: cada comando queda pendiente de aprobación de Jorge.',
    { scope: 'system', is_system: true, capabilities: ['system.exec'] }),
];
