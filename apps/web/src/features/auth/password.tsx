import { IconButton, TextField, type TextFieldProps } from '@realtimedocs/ui';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { estimatePasswordStrength } from '../../lib/passwordStrength';

/** A password input with a show/hide toggle. */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'suffix'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      spellCheck={false}
      autoCapitalize="none"
      suffix={
        <IconButton
          size="sm"
          label={visible ? 'Hide password' : 'Show password'}
          pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </IconButton>
      }
    />
  );
}

export interface PasswordStrengthHintProps {
  password: string;
  minLength: number;
  /** Name and email, so the hint can warn when the password contains them. */
  personal?: readonly string[];
}

/**
 * Advice under a new-password field: a three-step meter and one sentence.
 * It is a hint; the only hard rule is the minimum length. Rendered with
 * inline elements so it can sit inside a field's hint paragraph.
 */
export function PasswordStrengthHint({ password, minLength, personal }: PasswordStrengthHintProps) {
  const strength = estimatePasswordStrength(password, minLength, personal);
  return (
    <span className="auth-strength" data-level={strength.level} data-testid="password-strength">
      <span className="auth-strength__meter" aria-hidden="true">
        {[1, 2, 3].map((step) => (
          <span key={step} data-on={strength.score >= step ? '' : undefined} />
        ))}
      </span>
      <span className="auth-strength__text">
        {password === '' ? null : <strong>{strength.label}. </strong>}
        {strength.hint}
      </span>
    </span>
  );
}

export interface NewPasswordErrors {
  password?: string;
  confirm?: string;
}

/** Client-side checks for choosing a password. The server checks again. */
export function validateNewPassword(
  password: string,
  confirm: string,
  minLength: number,
  maxLength: number,
): NewPasswordErrors {
  const errors: NewPasswordErrors = {};
  const length = [...password].length;
  if (length === 0) errors.password = 'Choose a password.';
  else if (length < minLength) errors.password = `Use at least ${minLength} characters.`;
  else if (length > maxLength) errors.password = `Use at most ${maxLength} characters.`;
  if (confirm === '') errors.confirm = 'Enter the password again.';
  else if (confirm !== password) errors.confirm = 'The two passwords do not match.';
  return errors;
}
