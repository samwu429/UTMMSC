import { useEffect, useState } from 'react';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { Field, TextInput } from '../../../shared/ui/Field';
import { authApi } from '../api';

interface Props {
  email: string;
  purpose: 'register' | 'reset';
  value: string;
  onChange: (code: string) => void;
  onError: (message: string | null) => void;
}

const RESEND_SECONDS = 60;

/** Code input with a send button that counts down to match the server's resend interval. */
/** 带发送按钮的验证码输入框，倒计时与服务端重发间隔一致。 */
export function CodeField({ email, purpose, value, onChange, onError }: Props) {
  const [seconds, setSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const tr = useTr();

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  async function send() {
    onError(null);
    setSending(true);
    try {
      await authApi.requestCode({ email, purpose });
      setSeconds(RESEND_SECONDS);
      setSentTo(email);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <Field
      label={tr('邮箱验证码', 'Email code')}
      hint={sentTo !== null && sentTo === email ? tr(`已发送到 ${email}，没收到的话看看垃圾邮件`, `Sent to ${email}. Check your spam folder if it does not arrive.`) : undefined}
    >
      <div className="flex gap-2">
        <TextInput
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder={tr('6 位数字', '6 digits')}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        />
        <Button type="button" variant="secondary" onClick={send} disabled={!email || seconds > 0} loading={sending} className="shrink-0">
          {seconds > 0 ? `${seconds}s` : tr('发送', 'Send')}
        </Button>
      </div>
    </Field>
  );
}
