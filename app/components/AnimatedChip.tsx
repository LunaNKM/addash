'use client';

import { useEffect, useRef, useState } from 'react';

export function AnimatedChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const [animToken, setAnimToken] = useState(0);
  const prevActive = useRef(active);

  useEffect(() => {
    if (prevActive.current !== active) {
      setAnimToken(t => t + 1);
      prevActive.current = active;
    }
  }, [active]);

  return (
    <button
      key={animToken}
      className={active ? 'active' : ''}
      onClick={onClick}
      style={{
        animationName: animToken > 0 ? (active ? 'chip-activate' : 'deselect-shrink') : 'none',
        animationDuration: '300ms',
        animationTimingFunction: 'cubic-bezier(0.34,1.56,0.64,1)',
        animationFillMode: 'both',
      }}
    >
      {label}
    </button>
  );
}
