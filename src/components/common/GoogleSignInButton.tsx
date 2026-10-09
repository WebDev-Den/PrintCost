import { Button } from './Button.tsx';

export function GoogleSignInButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return <Button type="button" variant="outline" className="w-full" onClick={onClick} disabled={disabled}
    leftIcon={<svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 48 48">
      <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.9 6.1-15Z" />
      <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20.4 20.4 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M12.6 27.5a12.2 12.2 0 0 1 0-7.8v-5.3H5.8a20 20 0 0 0 0 18.4l6.8-5.3Z" />
      <path fill="#EA4335" d="M24 11.3c3 0 5.6 1 7.6 3l5.7-5.7A19.2 19.2 0 0 0 24 3.7a20.4 20.4 0 0 0-18.2 11l6.8 5.3c1.6-5 6.1-8.7 11.4-8.7Z" />
    </svg>}>
    Увійти через Google
  </Button>;
}
