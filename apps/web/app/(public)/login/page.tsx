import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { readSession } from "@/lib/auth";

export default async function LoginPage() {
  const session = await readSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Isotope
          </h1>
          <p className="text-sm text-muted-foreground">使用演示账号登录以继续</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>登录</CardTitle>
            <CardDescription>仅支持配置的内置账号</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
