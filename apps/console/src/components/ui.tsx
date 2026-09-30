// Primitives (DESIGN §7.1). Styled only through tokens; every control keeps a visible label and a 2px focus ring.
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import * as RSwitch from '@radix-ui/react-switch';
import * as RDialog from '@radix-ui/react-dialog';
import * as RTooltip from '@radix-ui/react-tooltip';
import { motion, AnimatePresence, animate, useReducedMotion } from 'motion/react';
import { Loader2, X, AlertTriangle, Info, OctagonAlert, RotateCw, Lock, ChevronDown } from 'lucide-react';
import type { Tone } from '@/lib/format';
import { useMedia } from '@/lib/hooks';

export const cx = clsx;

// ── Button ────────────────────────────────────────────────────────────────────────────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
type Size = 'sm' | 'md' | 'lg';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode; kbd?: string }
const variants: Record<Variant, string> = {
  primary: 'bg-fill text-on-accent hover:bg-fill-hover shadow-sm border border-transparent',
  secondary: 'bg-surface text-fg border border-control hover:bg-sunken',
  ghost: 'text-fg hover:bg-sunken border border-transparent',
  danger: 'bg-surface text-danger border border-danger hover:bg-danger-soft',
  'danger-solid': 'bg-danger text-surface border border-danger hover:opacity-90',
};
const sizes: Record<Size, string> = { sm: 'h-8 px-2.5 text-sm gap-1.5', md: 'h-9 px-3.5 text-base gap-2', lg: 'h-11 px-5 text-base gap-2' };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, kbd, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} {...rest} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx('inline-flex shrink-0 select-none items-center justify-center rounded-md font-medium whitespace-nowrap transition-[background-color,transform,opacity] duration-[var(--dur-fast)] ease-out active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-55 max-md:min-h-11',
        variants[variant], sizes[size], className)}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
      {kbd && <span className="kbd ml-0.5 max-md:hidden" aria-hidden>{kbd}</span>}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' }>(
  function IconButton({ label, size = 'md', className, children, ...rest }, ref) {
    return (
      <button ref={ref} aria-label={label} title={label} {...rest}
        className={cx('inline-grid shrink-0 place-items-center rounded-md text-muted transition-colors duration-[var(--dur-fast)] hover:bg-sunken hover:text-fg disabled:opacity-50',
          size === 'sm' ? 'size-8' : 'size-9', 'max-md:size-11', className)}>
        {children}
      </button>
    );
  });

// ── Badge ─────────────────────────────────────────────────────────────────────────────────────
const tones: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info', accent: 'bg-fill text-on-accent',
};
export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>{icon}{children}</span>;
}
export function Count({ n, tone = 'accent', label }: { n: number; tone?: 'accent' | 'danger'; label: string }) {
  if (!n) return null;
  return <span aria-label={label} className={cx('tabular inline-grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold leading-5',
    tone === 'danger' ? 'bg-danger text-surface' : 'bg-fill text-on-accent')}>{n}</span>;
}

// ── Cards, states ─────────────────────────────────────────────────────────────────────────────
export function Card({ className, children, glass, ...rest }: { className?: string; children: ReactNode; glass?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx(glass ? 'glass rounded-xl shadow-md' : 'card', className)}>{children}</div>;
}
export function Skeleton({ className }: { className?: string }) { return <div aria-hidden className={cx('skeleton', className)} />; }
export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return <div role="status" aria-label="Loading" className={cx('space-y-2', className)}>{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>;
}
export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-xl bg-sunken text-muted">{icon}</div>}
      <h2 className="text-lg">{title}</h2>
      {body && <p className="mt-1 max-w-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}
export function ErrorState({ error, onRetry }: { error: { message: string; details?: Record<string, unknown> } | null; onRetry?: () => void }) {
  if (!error) return null;
  const rid = error.details?.requestId as string | undefined;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-danger">
      <OctagonAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{error.message}</p>
        {rid && <p className="mt-0.5 font-mono text-xs opacity-80">request {rid}</p>}
      </div>
      {onRetry && <Button size="sm" variant="secondary" icon={<RotateCw className="size-3.5" aria-hidden />} onClick={onRetry}>Try again</Button>}
    </div>
  );
}
export function NoAccess({ what }: { what: string }) {
  return <EmptyState icon={<Lock className="size-5" aria-hidden />} title="You don't have access" body={`Your role can't open ${what} in this workspace. Ask a workspace admin if you need it.`} />;
}
export function Banner({ tone = 'info', title, children, action, role }: { tone?: 'info' | 'warning' | 'danger'; title: ReactNode; children?: ReactNode; action?: ReactNode; role?: 'alert' | 'status' }) {
  const Icon = tone === 'info' ? Info : tone === 'warning' ? AlertTriangle : OctagonAlert;
  return (
    <div role={role} className={cx('flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3', {
      'border-info/25 bg-info-soft text-info': tone === 'info', 'border-warning/25 bg-warning-soft text-warning': tone === 'warning', 'border-danger/25 bg-danger-soft text-danger': tone === 'danger' })}>
      <Icon className="size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1"><p className="font-medium">{title}</p>{children && <div className="text-sm opacity-90">{children}</div>}</div>
      {action}
    </div>
  );
}

// ── Meter ─────────────────────────────────────────────────────────────────────────────────────
export function Meter({ value, max, label, className }: { value: number; max: number; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone = pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-ink';
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className={cx('h-2 overflow-hidden rounded-full bg-sunken', className)}>
      <motion.div className={cx('h-full rounded-full', tone)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }} />
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────────────────────
export function Avatar({ text, kind = 'user', size = 36, className }: { text: string; kind?: 'user' | 'agent'; size?: number; className?: string }) {
  return (
    <span aria-hidden style={{ width: size, height: size }} className={cx('inline-grid shrink-0 place-items-center font-semibold',
      kind === 'agent' ? 'rounded-lg bg-sunken font-mono text-[11px] tracking-wide text-fg' : 'rounded-full bg-inverse text-xs text-fg-inverse', className)}>{text}</span>
  );
}

// ── Form controls ─────────────────────────────────────────────────────────────────────────────
const control = 'w-full rounded-md border border-control bg-surface px-3 text-base text-fg placeholder:text-muted transition-shadow focus:outline-2 focus:outline-offset-2 focus:outline-ring aria-[invalid=true]:border-danger';
export function Field({ label, hint, error, children, id, className }: { label: string; hint?: ReactNode; error?: string | null; children: (p: { id: string; describedBy?: string; invalid: boolean }) => ReactNode; id?: string; className?: string }) {
  const auto = useId(); const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined; const errId = error ? `${fid}-err` : undefined;
  return (
    <div className={cx('space-y-1.5', className)}>
      <label htmlFor={fid} className="block text-sm font-medium">{label}</label>
      {children({ id: fid, describedBy: [hintId, errId].filter(Boolean).join(' ') || undefined, invalid: Boolean(error) })}
      {hint && <p id={hintId} className="text-xs text-muted">{hint}</p>}
      {error && <p id={errId} className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} {...p} className={cx(control, 'h-9 max-md:h-11', className)} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} {...p} className={cx(control, 'py-2 leading-[var(--lh-md)]', className)} />;
});
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx('relative block', className?.includes('w-auto') && 'inline-block')}>
      <select {...p} className={cx(control, 'h-9 appearance-none pr-8 max-md:h-11', className)}>{children}</select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
    </span>
  );
}
export function Switch({ checked, onChange, label, description, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean; id?: string }) {
  const auto = useId(); const sid = id ?? auto;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={sid} className="font-medium">{label}</label>
        {description && <p id={`${sid}-d`} className="text-sm text-muted">{description}</p>}
      </div>
      <RSwitch.Root id={sid} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-describedby={description ? `${sid}-d` : undefined}
        className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full border border-control bg-sunken transition-colors duration-[var(--dur-base)] data-[state=checked]:border-transparent data-[state=checked]:bg-fill disabled:opacity-50 max-md:my-2.5">
        <RSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-surface shadow-md ring-1 ring-control/40 transition-transform duration-[var(--dur-base)] ease-out data-[state=checked]:translate-x-[21px]" />
      </RSwitch.Root>
    </div>
  );
}
export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: string; className?: string }) {
  return (
    <label className={cx('inline-flex min-h-11 cursor-pointer items-center gap-2.5 md:min-h-8', className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 cursor-pointer rounded accent-[var(--accent-ink)]" />
      <span>{label}</span>
    </label>
  );
}

// ── Segmented control / tabs with a sliding pill ──────────────────────────────────────────────
export function Segmented<T extends string>({ value, onChange, options, label, id, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string; id: string; size?: 'sm' | 'md' }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    onChange(options[n].value); refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-sunken p-1">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={o.value} ref={(el) => { refs.current[i] = el; }} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} onKeyDown={(e) => onKey(e, i)} onClick={() => onChange(o.value)}
            className={cx('relative isolate inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors', size === 'sm' ? 'h-7 px-2.5 text-sm' : 'h-8 px-3 text-sm max-md:h-10',
              on ? 'text-fg' : 'text-muted hover:text-fg')}>
            {on && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 -z-10 rounded-md bg-surface shadow-sm" transition={{ type: 'spring', bounce: 0, duration: 0.3 }} />}
            {o.label}
            {o.count !== undefined && <span className="tabular text-xs text-muted">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Dialog / sheet ────────────────────────────────────────────────────────────────────────────
/** Centered dialog on desktop, bottom sheet on phones. Focus trap, Esc, focus return: Radix. */
export function Sheet({ open, onOpenChange, title, description, children, footer, wide }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const phone = useMedia('(max-width: 639px)');
  const reduce = useReducedMotion();
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-inverse/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
            </RDialog.Overlay>
            <RDialog.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
              <motion.div
                initial={reduce ? { opacity: 0 } : phone ? { y: '100%' } : { opacity: 0, y: 12, scale: 0.98 }}
                animate={reduce ? { opacity: 1 } : phone ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : phone ? { y: '100%' } : { opacity: 0, y: 8, scale: 0.98 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.32 }}
                className={cx('fixed z-50 flex max-h-[92dvh] flex-col bg-surface shadow-lg outline-none',
                  phone ? 'inset-x-0 bottom-0 rounded-t-2xl pb-safe' : cx('top-1/2 left-1/2 w-[calc(100vw-32px)] rounded-xl', wide ? 'max-w-2xl' : 'max-w-md'))}
                style={phone ? undefined : { translateX: '-50%', translateY: '-50%' }}>
                {phone && <div aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-control/50" />}
                <div className="flex items-start gap-3 px-5 pt-4 pb-2">
                  <div className="min-w-0 flex-1">
                    <RDialog.Title className="text-lg font-semibold">{title}</RDialog.Title>
                    {description ? <RDialog.Description className="mt-0.5 text-sm text-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
                  </div>
                  <RDialog.Close asChild><IconButton label="Close" size="sm"><X className="size-4" aria-hidden /></IconButton></RDialog.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>
                {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
              </motion.div>
            </RDialog.Content>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  );
}

// ── Tooltip (supplementary only) ──────────────────────────────────────────────────────────────
export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RTooltip.Root delayDuration={300}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content sideOffset={6} className="z-[60] max-w-xs rounded-md bg-inverse px-2.5 py-1.5 text-xs text-fg-inverse shadow-lg">{content}</RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
export const TipProvider = RTooltip.Provider;

// ── Numbers that count up once ────────────────────────────────────────────────────────────────
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString('en-US'), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) { setShown(value); return; }
    const c = animate(from.current, value, { duration: 0.8, ease: [0.2, 0.8, 0.2, 1], onUpdate: setShown });
    from.current = value;
    return () => c.stop();
  }, [value, reduce]);
  return <span className={cx('tabular', className)}>{format(shown)}</span>;
}

// ── Page scaffolding ──────────────────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="text-xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 max-sm:w-full">{actions}</div>}
      {children}
    </header>
  );
}
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
      className={cx('mx-auto w-full px-4 py-5 md:px-6 md:py-6', wide ? 'max-w-[1440px]' : 'max-w-[1200px]', className)}>{children}</motion.div>
  );
}
export const listStagger = { hidden: {}, show: { transition: { staggerChildren: 0.035 } } };
export const listItem = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] as const } } };
