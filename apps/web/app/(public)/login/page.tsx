import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { readSession } from "@/lib/auth";

export default async function LoginPage() {
  const session = await readSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Isotope
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            欢迎回来
          </h1>
          <p className="text-sm text-muted-foreground">使用演示账号登录以继续</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-8 shadow-soft">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
