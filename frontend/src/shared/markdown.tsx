import { Fragment } from 'react';

// Renderizador de markdown minimalista y seguro (sin dangerouslySetInnerHTML).
// Soporta: **negrita**, *cursiva*, `código`, saltos de línea y listas con "- " o "* ".

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.+?\*\*|`.+?`|\*.+?\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={i} style={{ paddingLeft: 12 }}>
              · {renderInline(trimmed.slice(2), `l${i}`)}
            </div>
          );
        }
        return (
          <Fragment key={i}>
            {renderInline(line, `l${i}`)}
            {i < lines.length - 1 && <br />}
          </Fragment>
        );
      })}
    </>
  );
}
