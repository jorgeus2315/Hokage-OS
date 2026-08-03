import { useState } from 'react';
import { BootView } from './views/BootView';
import { GameLayout } from './views/GameLayout';

export default function App() {
  const [booted, setBooted] = useState(false);

  if (!booted) return <BootView onDone={() => setBooted(true)} />;
  return <GameLayout />;
}
