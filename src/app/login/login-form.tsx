"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "signin" | "signup" | "magic";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
        });
        if (error) throw error;
        setNotice("Check your inbox for a sign-in link.");
        return;
      }
      const { data, error } =
        mode === "signup"
          ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/confirm` } })
          : await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) {
        setNotice("Confirm your email to finish creating your account.");
        return;
      }
      router.replace("/board");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-10 space-y-5" aria-describedby={error ? "auth-error" : undefined}>
      <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-sm">
        {(
          [
            ["signin", "Sign in"],
            ["signup", "Create account"],
            ["magic", "Magic link"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className="rounded-md px-2 py-1.5 font-medium text-muted-foreground transition-colors aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      {mode !== "magic" && (
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}

      {error && (
        <p id="auth-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "One moment…" : mode === "signup" ? "Create account" : mode === "magic" ? "Send me a link" : "Sign in"}
      </Button>
    </form>
  );
}
