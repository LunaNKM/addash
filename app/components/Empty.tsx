import type { ReactNode } from 'react';

export function Empty({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <section className="empty">
      <div className="card">
        <div className="icon">📊</div>
        <h1>GFU Dash</h1>
        <p>{message}</p>
        {action}
      </div>
    </section>
  );
}
