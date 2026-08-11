// ═══════════════════════════════════════════════════════════════════════════
// rolePolicy — POLÍTICA DE SEGURIDAD de los roles (Fase 1c).
// ═══════════════════════════════════════════════════════════════════════════
//
// CÓDIGO, no dato. Es el techo que ninguna CONFIGURACIÓN de rol puede superar —
// ni la de Jorge por API, ni (en Fase 5) la de Hokage al crear un especialista.
// Regla rectora: Hokage puede decidir QUÉ especialista necesita, pero no puede
// otorgarse capacidades que esta política no permita. Punto de aplicación único:
// validateRoleConfig(), llamada por roleService en create/update.

// Tools que un rol definido como DATO puede recibir (allowlist — L·2).
export const GRANTABLE_TOOLS: readonly string[] = [
  'web.browser',
  'google.trends',
  'trend.report',
  'content.create',
  'memory.write',
  'decision.create',
  'memory.remember',
];

// Tools reservadas a roles de SISTEMA (scope='system'). Nunca concedibles a un rol de negocio.
// system.exec vive solo en Hermes — ejecución de terminal jamás se duplica (CORE SPEC §9.1).
export const SYSTEM_ONLY_TOOLS: readonly string[] = ['system.exec'];

// Nivel de autonomía máximo configurable. El Nivel 3 (gasto, publicación, cambios
// estructurales, comandos) SIEMPRE requiere aprobación — no es configurable (Especificación §3).
export const MAX_AUTONOMY = 2;

// Presupuesto mensual máximo por rol definido como dato (L·2b).
export const MAX_BUDGET_USD = 20;

export interface RoleConfigInput {
  tools?: string[];
  default_autonomy?: number;
  monthly_budget_usd?: number;
  scope?: string;
  is_system?: boolean | number;
}

export interface PolicyResult {
  ok: boolean;
  error?: string;
}

// Valida una configuración de rol contra la política. `existing` se pasa en updates para
// conocer el scope real del rol (un rol de sistema puede tener system.exec; uno de negocio no).
export function validateRoleConfig(
  cfg: RoleConfigInput,
  ctx: { creating: boolean; existing?: { scope: string; is_system: boolean } }
): PolicyResult {
  // is_system nunca se establece por API — solo lo fijan los seeds (código).
  if (cfg.is_system === true || cfg.is_system === 1) {
    return { ok: false, error: 'is_system no se puede establecer por API (reservado a roles del sistema).' };
  }

  // scope: crear un rol de sistema por API sería una vía de escalada (podría pedir system.exec).
  if (ctx.creating) {
    if (cfg.scope && cfg.scope !== 'business') {
      return { ok: false, error: 'No se puede crear un rol de scope "system" por API — reservado a roles del sistema.' };
    }
  } else if (cfg.scope && ctx.existing && cfg.scope !== ctx.existing.scope) {
    return { ok: false, error: 'El scope de un rol no se puede cambiar por API.' };
  }

  const scope = ctx.creating ? 'business' : (ctx.existing?.scope ?? 'business');

  // tools: subconjunto de la allowlist (+ system-only si el rol ya es de sistema).
  if (cfg.tools) {
    const allowed = new Set<string>([...GRANTABLE_TOOLS, ...(scope === 'system' ? SYSTEM_ONLY_TOOLS : [])]);
    for (const t of cfg.tools) {
      if (!allowed.has(t)) {
        const reason = SYSTEM_ONLY_TOOLS.includes(t)
          ? `"${t}" está reservada a roles de sistema (solo Hermes).`
          : `"${t}" no está en la allowlist de tools concedibles.`;
        return { ok: false, error: `Tool no permitida: ${reason}` };
      }
    }
  }

  // autonomía
  if (cfg.default_autonomy != null && (cfg.default_autonomy < 0 || cfg.default_autonomy > MAX_AUTONOMY)) {
    return { ok: false, error: `Autonomía fuera de rango 0–${MAX_AUTONOMY} (el Nivel 3 siempre requiere aprobación).` };
  }

  // presupuesto
  if (cfg.monthly_budget_usd != null && (cfg.monthly_budget_usd < 0 || cfg.monthly_budget_usd > MAX_BUDGET_USD)) {
    return { ok: false, error: `Presupuesto fuera de rango 0–${MAX_BUDGET_USD} USD/mes.` };
  }

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// NIVELES DE AUTONOMÍA 0–3 (Fase 2)
// ═══════════════════════════════════════════════════════════════════════════
//
// La autonomía es una COMPUERTA sobre las capacidades que el rol/tools/política ya
// conceden — nunca las amplía. No añade tools, no concede system.exec, no sube el
// presupuesto. Solo puede restringir (Nivel 0) o permitir auto-ejecución de lo que
// ya está permitido (Nivel 2). Se aplica en los dos puntos de efecto: tool calls
// (aiService) y marcadores (agentRuntime). No introduce un segundo mecanismo de
// aprobación — reutiliza approveDecision/resolveDecisionApproval.
//
//   0 Observador — solo tools de lectura; sin acciones ni decisiones.
//   1 Proponente — trabaja (tools operativas) y propone; las decisiones quedan pendientes.
//   2 Operativo  — como 1, y además auto-aprueba SUS decisiones no críticas (no gasto,
//                  no publicación/financiero/legal, sin entity_type, riesgo no alto).
//   3 Autónomo   — reservado a roles de sistema; no concedible por API (cap = 2, Fase 1).

// Clasificación de efecto de cada tool. Desconocida → 'operational' (bloqueada en Nivel 0,
// permitida en 1+): conservador, nunca clasifica algo nuevo como lectura por error.
export type ToolEffect = 'read' | 'operational' | 'approval';

export const TOOL_EFFECTS: Record<string, ToolEffect> = {
  'web.browser':    'read',
  'google.trends':  'read',
  'trend.report':   'operational',
  'content.create': 'operational',
  'memory.write':   'operational',
  'memory.remember': 'operational',
  'decision.create': 'approval',
  'system.exec':    'approval',
};

export function toolEffect(toolId: string): ToolEffect {
  return TOOL_EFFECTS[toolId] ?? 'operational';
}

// ¿Puede un agente con esta autonomía INVOCAR esta tool? Nunca amplía la lista del rol —
// el llamador ya interseca con las tools del rol; esto solo puede quitar (Nivel 0).
export function autonomyAllowsTool(autonomy: number, toolId: string): boolean {
  if (autonomy <= 0) return toolEffect(toolId) === 'read';
  return true; // Nivel 1+: puede usar lo que su rol le da (approval crea pendiente)
}

// ¿Auto-aprueba un agente con esta autonomía una Decision que acaba de crear?
// Conservador: el Nivel 3 de categorías (gasto, publicación, sistema) SIEMPRE es humano (§3).
export function autonomyAutoApproves(
  autonomy: number,
  d: { amount?: number | null; risk_level?: string | null; category?: string | null; entity_type?: string | null }
): boolean {
  if (autonomy < 2) return false;                                  // 0/1: nunca
  if (d.amount != null && d.amount > 0) return false;              // gasto → humano
  if (d.entity_type) return false;                                 // system_exec/objective/… → humano
  if (d.risk_level === 'high') return false;                       // alto riesgo → humano
  if (d.category && new Set(['PUBLICATION', 'FINANCIAL', 'LEGAL']).has(d.category)) return false;
  return true;
}
