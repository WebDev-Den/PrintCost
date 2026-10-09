export const TURNSTILE_ACTIONS = ['login', 'register', 'forgot_password', 'reset_password', 'resend_verification'] as const;
export type TurnstileAction = typeof TURNSTILE_ACTIONS[number];

export function canBypassTurnstileLocally(env: Record<string, unknown>, hostname: string): boolean {
  return env.DEV === true && env.VITE_USE_FIREBASE_EMULATORS === 'true'
    && typeof env.VITE_FIREBASE_PROJECT_ID === 'string' && env.VITE_FIREBASE_PROJECT_ID.startsWith('demo-')
    && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}
