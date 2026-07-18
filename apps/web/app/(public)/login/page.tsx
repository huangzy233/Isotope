import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { readSession } from "@/lib/auth";

export default async function LoginPage() {
  const session = await readSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="space-y-1 text-center">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Isotope
            </h1>
            <CardDescription>使用演示账号登录以继续</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
