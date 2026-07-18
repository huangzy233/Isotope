import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { readSession } from "@/lib/auth";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader username={session.username} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
