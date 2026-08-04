> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §5. Congelado.

## Goal System

🔒 **CONGELADO**, con la corrección de [[Modelo Multi-Venture|§3]] ya incorporada (`venture_id` pendiente de añadir).

El Goal System (`objectives` → `obj_plans` → `obj_milestones` → `work_items.milestone_id`) es real, probado, y ya se autocorrigió esta sesión: los objetivos financieros ya no se marcan `achieved` automáticamente sin verificación (ver el fix de `objectiveService.ts` — un objetivo con criterio de ingresos pasa por `pending_review` + Decision de confirmación humana, usando el mismo patrón `entity_type`/`entity_id` que gobierna todo el sistema de aprobación).

**Decisión que se congela aquí:** ese patrón de detección por regex (`REVENUE_PATTERN` sobre título/criterio) es un parche honesto, no una verificación real de ingresos — y se mantiene así hasta que exista una integración de ventas real (ver [[Plugin System - Arquitectura Completa]] §8). No se over-diseña una verificación "inteligente" de objetivos antes de que haya datos reales que verificar contra algo.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Modelo Multi-Venture]] — threading de `venture_id` pendiente
- [[Plugin System - Arquitectura Completa]] — integración de ventas real que destrabaría la verificación
- [[Memory System]] — objetivo confirmado alcanzado es uno de los puntos de captura automática
