import { redirect } from "next/navigation";
import { Eye, Layers, MessageSquare } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "@/components/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { readSession } from "@/lib/auth";

const capabilities = [
  {
    icon: MessageSquare,
    title: "对话驱动生成",
    description: "自然语言描述需求，智能体生成并迭代",
  },
  {
    icon: Eye,
    title: "实时预览",
    description: "改码后自动构建，App Viewer 即时更新",
  },
  {
    icon: Layers,
    title: "Plan / Team 模式",
    description: "需求澄清与多智能体编排可按需开关",
  },
] as const;

export default async function LoginPage() {
  const session = await readSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen">
      <section className="hidden w-1/2 flex-col justify-center bg-primary/5 px-10 py-12 md:flex lg:px-16">
        <div className="mx-auto w-full max-w-md space-y-8">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <BrandMark className="h-8 w-8" />
              <p className="text-sm font-semibold tracking-tight text-primary">
                Isotope
              </p>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              智能应用生成平台
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              用 AI 对话构建应用，并实时预览
            </p>
          </div>
          <ul className="space-y-5">
            {capabilities.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex w-full items-center justify-center bg-background px-4 py-12 md:w-1/2">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader className="space-y-3 text-center">
              <div className="flex flex-col items-center gap-2">
                <BrandMark className="h-10 w-10" />
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                  Isotope
                </h2>
              </div>
              <CardDescription>使用演示账号登录以继续</CardDescription>
            </CardHeader>
            <CardContent>
              <LoginForm />
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
