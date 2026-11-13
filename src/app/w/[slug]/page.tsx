import { notFound, redirect } from "next/navigation";
import { getUser, requireTenant } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { HttpError } from "@/lib/security";
import { WorkspaceApp } from "@/components/workspace-app";

export const dynamic = "force-dynamic";
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!(await getUser())) redirect("/login");
  const { slug } = await params;
  let context;
  try {
    context = await requireTenant(slug);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
  return (
    <WorkspaceApp initial={await getWorkspace(context.tenant, context.user)} />
  );
}
