import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role === "platform_admin") redirect("/admin");
  const [tenant] = await db.query<{ slug: string }>(
    "SELECT slug FROM tenants WHERE id=$1",
    [user.tenant_id],
  );
  redirect(tenant ? `/w/${tenant.slug}` : "/login");
}
