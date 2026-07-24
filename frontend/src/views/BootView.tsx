import { useEffect, useRef, useState } from 'react';

const LINES = [
  'HOKAGE OS v0.5.0',
  '',
  'Iniciando sistema...',
  'Conectando base de datos... OK',
  'Cargando agentes... OK',
  'Verificando OpenRouter... OK',
  'Activando runtime autónomo... OK',
  'Sincronizando WebSocket... OK',
  '',
  'Bienvenido, Jorge.',
];

export function BootView({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [pct, setPct] = useState(0);
  // onDone puede cambiar de identidad en cada render del padre; se guarda en
  // un ref para que la secuencia de arranque corra una única vez.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      if (i < LINES.length) {
        setLines((p) => [...p, LINES[i]]);
        setPct(Math.round((i / LINES.length) * 100));
        i++;
      } else {
        clearInterval(t);
        setPct(100);
        setTimeout(() => onDoneRef.current(), 700);
      }
    }, 200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="hk-boot">
      <div className="hk-boot-box">
        <div className="hk-boot-logo">
          <em>HOKAGE</em> OS
        </div>
        <div className="hk-boot-lines">
          {lines.map((l, i) => {
            if (l == null) return null;
            const isLast = i === lines.length - 1;
            if (l.includes(' OK')) {
              return (
                <div className="hk-boot-line hk-boot-line--ok" key={i}>
                  {l.replace(' OK', '')} <b>OK</b>
                </div>
              );
            }
            return (
              <div className={`hk-boot-line${l.includes('Bienvenido') ? ' hk-boot-line--hi' : ''}`} key={i}>
                {l || ' '}
                {isLast && <span className="hk-boot-cursor" />}
              </div>
            );
          })}
        </div>
        <div className="hk-boot-track">
          <div className="hk-boot-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="hk-boot-pct">{pct}%</div>
      </div>
    </div>
  );
}
