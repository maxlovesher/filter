import { useState, type ReactNode } from 'react';

interface SectionProps {
  title: string;
  changed?: boolean;
  onReset?: () => void;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Section({ title, changed, onReset, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section${open ? ' is-open' : ''}`}>
      <header className="section-head">
        <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="chev" aria-hidden>
            ▸
          </span>
          {title}
          {changed && <span className="dot" title="Adjusted" />}
        </button>
        {changed && onReset && (
          <button className="link-btn" onClick={onReset}>
            Reset
          </button>
        )}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
