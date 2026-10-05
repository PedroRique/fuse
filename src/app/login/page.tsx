import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Fuse" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="font-mono text-xs tracking-[0.3em] text-muted-foreground uppercase">Fuse</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance">
          Your tasks take up space as they run out of time.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Other task managers organize your tasks. This one makes them impossible to ignore.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
