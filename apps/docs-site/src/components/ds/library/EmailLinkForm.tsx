// "Enter your email, Bridge sends you a link", shared by the Library gate (LibraryGate.tsx, readers by work email) and
// a team's sign-in for email contributors (NoAccess.tsx, lib/contribute.ts): the field and Send me a link; then
// "Check your inbox" with the address masked and Use another email. A problem is said on the field, an expired link
// above it, a site without email sign-in instead of the form. The caller owns the title and what sending does.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Mail } from 'lucide-react';
import { Alert, Button, Icon, Input } from '@bridge-ds/react';
import { maskEmail } from '../../../lib/library-access';
import { isEmail } from '../../../lib/invites';
import '../../../styles/library-access.css';

export interface EmailLinkWords {
  emailLabel: string;
  emailPlaceholder: string;
  send: string;
  badEmail: string;
  sentText: (masked: string) => string;
  otherEmail: string;
  expired: string;
  network: string;
}

export interface EmailLinkFormProps {
  words: EmailLinkWords;
  /** Sends the link. Throws to say why it did not (its message shows on the field). */
  send: (email: string) => Promise<void>;
  /** A problem with the address said at once, before any link is spent (a domain the team does not take). */
  check?: (email: string) => string | null;
  /** True when `send` failed because the site has no email sign-in: the form gives way to `unavailable`. */
  isUnavailable?: (err: unknown) => boolean;
  unavailable?: ReactNode;
  /** The link the visitor opened had expired: said above the field until a new one is sent. */
  expired?: boolean;
  /** Called when the "Check your inbox" state starts or ends (the caller's title follows it). */
  onSent?: (sent: boolean) => void;
  /** Focus the field when the form appears (it opened on a click). */
  autoFocus?: boolean;
  /** The lead sentence, shown with the form only. */
  children?: ReactNode;
}

export default function EmailLinkForm({ words, send, check, isUnavailable, unavailable, expired = false, onSent, autoFocus = false, children }: EmailLinkFormProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [showExpired, setShowExpired] = useState(expired);
  const field = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (sentTo) back.current?.focus();
    onSent?.(Boolean(sentTo));
  }, [sentTo]);

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!isEmail(value)) return setError(words.badEmail);
    // Said at once, without spending a link; the server checks again and decides.
    const problem = check?.(value) ?? null;
    if (problem) return setError(problem);
    setError(null);
    setSending(true);
    try {
      await send(value);
      setShowExpired(false);
      setSentTo(maskEmail(value));
    } catch (err) {
      if (isUnavailable?.(err)) setOff(true);
      else setError(err instanceof Error && err.message ? err.message : words.network);
    } finally {
      setSending(false);
    }
  };

  if (off) return <>{unavailable}</>;

  if (sentTo)
    return (
      <>
        <p className="t-body" role="status">
          {words.sentText(sentTo)}
        </p>
        <div className="lgt-actions">
          <Button
            ref={back}
            variant="secondary"
            size="lg"
            onClick={() => {
              setSentTo(null);
              setEmail('');
              requestAnimationFrame(() => field.current?.focus());
            }}
          >
            {words.otherEmail}
          </Button>
        </div>
      </>
    );

  return (
    <>
      {children}
      {showExpired && (
        <Alert tone="warning" className="lgt-alert">
          {words.expired}
        </Alert>
      )}
      <form className="lgt-form" noValidate onSubmit={(e) => void submit(e)}>
        <Input
          ref={field}
          label={words.emailLabel}
          hideLabel
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          size="lg"
          prefix={<Icon icon={Mail} size="sm" />}
          placeholder={words.emailPlaceholder}
          value={email}
          error={error ?? undefined}
          onValueChange={(v) => {
            setEmail(v);
            if (error) setError(null);
          }}
          className="lgt-input"
        />
        <Button type="submit" variant="primary" size="lg" loading={sending} className="lgt-send">
          {words.send}
        </Button>
      </form>
    </>
  );
}
