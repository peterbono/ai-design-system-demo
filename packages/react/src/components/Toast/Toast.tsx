import { useMemo, useRef, type ReactNode } from 'react';
import { Toast as BaseToast } from '@base-ui/react/toast';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cx } from '../../utils/cx';
import { useScopeAttributes } from '../../theme';
import { Button } from '../Button';
import { Icon, type LucideIcon } from '../Icon';
import { IconButton } from '../IconButton';
import { Spinner } from '../Spinner';
import styles from './Toast.module.css';

export type ToastTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'loading';

export interface ToastAction {
  /** Verb naming what happens: "Undo", "View pull request". */
  label: string;
  onClick: () => void;
}

export interface ToastProps {
  /** One short line: what happened. "Tokens published". */
  title: ReactNode;
  /** Optional detail: what changed or what to do next. */
  description?: ReactNode;
  /** Icon and meaning. Default `neutral`. `loading` shows a spinner and never times out. */
  tone?: ToastTone;
  /** One action, for example Undo. Toasts with an action stay until dismissed or acted on. */
  action?: ToastAction;
  /** Milliseconds before auto dismiss. `0` keeps it until closed. Default 5000 (0 with an action or for loading). */
  timeout?: number;
  /** `high` interrupts screen readers (assertive). Default `high` for danger, `low` otherwise. */
  priority?: 'low' | 'high';
  /** Reuse an id to update a toast in place. */
  id?: string;
  /** Called when the toast closes (timeout, swipe, close button or action). */
  onClose?: () => void;
}

/** @deprecated alias kept for readability in app code. */
export type ToastOptions = ToastProps;

export interface ToastPromiseMessages<T> {
  loading: string;
  success: string | ((value: T) => string);
  error: string | ((error: unknown) => string);
}

export interface UseToastReturn {
  /** Shows a toast and returns its id. */
  add: (toast: ToastProps) => string;
  success: (title: ReactNode, options?: Omit<ToastProps, 'title' | 'tone'>) => string;
  error: (title: ReactNode, options?: Omit<ToastProps, 'title' | 'tone'>) => string;
  warning: (title: ReactNode, options?: Omit<ToastProps, 'title' | 'tone'>) => string;
  info: (title: ReactNode, options?: Omit<ToastProps, 'title' | 'tone'>) => string;
  /** Loading toast that turns into success or error when the promise settles. */
  promise: <T>(promise: Promise<T>, messages: ToastPromiseMessages<T>) => Promise<T>;
  /** Updates an open toast. */
  update: (id: string, toast: Partial<ToastProps>) => void;
  /** Closes one toast, or all when called without an id. */
  close: (id?: string) => void;
}

function toManagerOptions(t: Partial<ToastProps>) {
  const { tone, action, timeout, priority, ...rest } = t;
  const out: Record<string, unknown> = { ...rest };
  if (tone !== undefined) out.type = tone;
  if (action) out.actionProps = { children: action.label, onClick: action.onClick };
  const keep = action || tone === 'loading';
  if (timeout !== undefined) out.timeout = timeout;
  else if (keep) out.timeout = 0;
  if (priority !== undefined) out.priority = priority;
  else if (tone === 'danger') out.priority = 'high';
  return out;
}

/** Imperative API to show toasts. Must be called under a ToastProvider. */
export function useToast(): UseToastReturn {
  // The manager object changes identity whenever the toast list changes. Keep the helpers stable so
  // callers can list them in effect dependencies without re-adding toasts in a loop.
  const current = BaseToast.useToastManager();
  const managerRef = useRef(current);
  managerRef.current = current;
  return useMemo(() => {
    const manager = {
      add: ((...a: unknown[]) => (managerRef.current.add as (...x: unknown[]) => string)(...a)) as typeof current.add,
      update: ((...a: unknown[]) => (managerRef.current.update as (...x: unknown[]) => void)(...a)) as typeof current.update,
      close: ((...a: unknown[]) => (managerRef.current.close as (...x: unknown[]) => void)(...a)) as typeof current.close,
      promise: ((...a: unknown[]) => (managerRef.current.promise as (...x: unknown[]) => unknown)(...a)) as typeof current.promise,
    };
    const add = (t: ToastProps) => manager.add(toManagerOptions({ tone: 'neutral', ...t }) as never);
    const tone = (toneName: ToastTone) => (title: ReactNode, options?: Omit<ToastProps, 'title' | 'tone'>) =>
      add({ ...options, title, tone: toneName });
    return {
      add,
      success: tone('success'),
      error: tone('danger'),
      warning: tone('warning'),
      info: tone('info'),
      update: (id, t) => manager.update(id, toManagerOptions(t) as never),
      close: (id) => manager.close(id),
      promise: (promise, messages) =>
        manager.promise(promise, {
          loading: { title: messages.loading, type: 'loading', timeout: 0 },
          success: (value: unknown) => ({
            title: typeof messages.success === 'function' ? (messages.success as (v: unknown) => string)(value) : messages.success,
            type: 'success',
            timeout: 5000,
          }),
          error: (err: unknown) => ({
            title: typeof messages.error === 'function' ? messages.error(err) : messages.error,
            type: 'danger',
            priority: 'high',
            timeout: 0,
          }),
        } as never) as typeof promise,
    };
  }, []);
}

const TONE_ICON: Partial<Record<ToastTone, LucideIcon>> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

function ToastList() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((toast, index) => {
    const tone = (toast.type ?? 'neutral') as ToastTone;
    const glyph = TONE_ICON[tone];
    return (
      <BaseToast.Root
        key={toast.id}
        toast={toast}
        className={cx(styles.toast, styles[tone])}
        // The frontmost toast (index 0) paints above the ones stacked behind it.
        style={{ zIndex: toasts.length - index }}
      >
        <BaseToast.Content className={styles.content}>
          {tone === 'loading' ? (
            <Spinner size="md" tone="signal" className={styles.icon} />
          ) : (
            glyph && <Icon icon={glyph} size="md" className={styles.icon} />
          )}
          <div className={styles.text}>
            <BaseToast.Title className={styles.title} />
            <BaseToast.Description className={styles.description} />
            {toast.actionProps && (
              <div className={styles.actions}>
                <BaseToast.Action render={<Button variant="secondary" size="sm" />} />
              </div>
            )}
          </div>
          <BaseToast.Close render={<IconButton icon={X} label="Dismiss notification" size="sm" className={styles.close} />} />
        </BaseToast.Content>
      </BaseToast.Root>
    );
  });
}

export interface ToastProviderProps {
  children?: ReactNode;
  /** Toasts visible at once; older ones are hidden until the front ones close. Default 3. */
  limit?: number;
  /** Default auto-dismiss time in milliseconds. Default 5000. */
  timeout?: number;
}

/**
 * Hosts the toast queue and renders the viewport (bottom end of the screen, an F6 landmark).
 * Place once near the app root, inside ThemeProvider.
 */
export function ToastProvider({ children, limit = 3, timeout = 5000 }: ToastProviderProps) {
  return (
    <BaseToast.Provider limit={limit} timeout={timeout}>
      {children}
      <Viewport />
    </BaseToast.Provider>
  );
}

function Viewport() {
  const scope = useScopeAttributes();
  return (
    <BaseToast.Portal>
      <BaseToast.Viewport className={styles.viewport} {...scope}>
        <ToastList />
      </BaseToast.Viewport>
    </BaseToast.Portal>
  );
}
