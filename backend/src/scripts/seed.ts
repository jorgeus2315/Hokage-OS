import { initSchema } from '../db/init.js';
import { run } from '../db/init.js';

async function seed() {
  await initSchema();

  // Prompt base por agente. Ya asumimos ids 1..7; si existen, los actualizamos.
  const prompts = [
    { id: 1, content: 'Eres Hokage, Director General. Coordinas todos los agentes, resumes el estado del negocio, propones estrategias. Hablas en español. Nunca gastas dinero sin aprobación de Jorge. Tono profesional pero cercano.' },
    { id: 2, content: 'Eres el Explorador, Investigador de Mercado. Buscas tendencias, analizas competencia, detectas oportunidades. Solo propones con datos. Calculas ROI antes de proponer. Aprendes de rechazos.' },
    { id: 3, content: 'Eres el Escritor, Creador de Contenido. Creas títulos, descripciones y tags optimizados SEO para Etsy. Máximo 13 tags, título máximo 140 caracteres. Adaptas tono al nicho.' },
    { id: 4, content: 'Eres Tráfico, Gestor de Tráfico. Analizas de donde vienen las visitas, optimizas keywords, propones estrategias de visibilidad. Reportas métricas de tráfico.' },
    { id: 5, content: 'Eres Soporte, Atención al Cliente. Respondes dudas de clientes, gestionas incidencias, propones mejoras basadas en feedback de clientes.' },
    { id: 6, content: 'Eres Finanzas, Director Financiero. Registras ingresos y gastos, generas reportes diarios, alertas si hay problemas. Nunca redondeas, usa céntimos exactos.' },
    { id: 7, content: 'Eres Operaciones, Director de Operaciones. Monitorizas que todo funcione, detectas fallos, optimizas procesos, reportas problemas a Hokage.' },
  ];

  for (const p of prompts) {
    await run(
      'INSERT OR REPLACE INTO agent_prompts (id, agent_id, prompt_type, content, version, active) VALUES (?, ?, ?, ?, ?, ?)',
      [p.id, p.id, 'system', p.content, 1, 1]
    );
  }

  // Tools
  const tools = [
    ['EtsyAPI', 'marketplace', 0],
    ['PrintifyAPI', 'production', 0],
    ['GoogleTrends', 'research', 0],
    ['WebBrowser', 'research', 0],
    ['OpenRouter', 'ai', 0],
  ];
  for (const [name, category, enabled] of tools) {
    await run(
      'INSERT INTO tools (name, category, enabled) VALUES (?, ?, ?)',
      [name, category, enabled]
    );
  }

  // Achievements
  const achievements = [
    ['first_sale', 'Primera venta', 'Consigue tu primera venta', 'sales', 500, '1', '🎉'],
    ['ten_sales', '10 ventas', 'Llega a 10 ventas totales', 'sales', 1000, '10', '🔥'],
    ['first_product', 'Primer producto', 'Publica tu primer producto', 'products', 300, '1', '📦'],
    ['ten_products', '10 productos', 'Publica 10 productos', 'products', 800, '10', '🏭'],
    ['first_business', 'Primer negocio', 'Crea tu primer negocio', 'businesses', 200, '1', '🏢'],
    ['revenue_100', '$100 ingresos', 'Genera $100 en ingresos', 'revenue', 1000, '100', '💰'],
    ['revenue_1000', '$1000 ingresos', 'Genera $1000 en ingresos', 'revenue', 5000, '1000', '🏆'],
  ];

  for (const [code, title, description, condition_type, xp_reward, condition_value, icon] of achievements) {
    await run(
      'INSERT OR IGNORE INTO achievements (code, title, description, category, xp_reward, condition_type, condition_value, icon) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [code, title, description, condition_type, xp_reward, condition_type, condition_value, icon]
    );
  }

  // Progress nivel inicial Jorge
  await run(
    'INSERT OR IGNORE INTO agent_progress (entity_type, entity_id, xp, level) VALUES (?, ?, ?, ?)',
    ['user', 1, 0, 1]
  );

  console.log('Seed ejecutado correctamente');
}

seed().catch((error) => {
  console.error('Error en seed:', error);
  process.exit(1);
});
