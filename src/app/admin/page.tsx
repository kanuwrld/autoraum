import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getAdminData } from "@/lib/admin";
import { AdminApp } from "@/components/admin-app";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role !== "platform_admin") notFound();
  return <AdminApp initial={await getAdminData()} user={user} />;
}
