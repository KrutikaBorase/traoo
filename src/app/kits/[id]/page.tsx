import { currentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { KitWorkspace } from "@/components/kit-workspace";

export default async function KitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  return <KitWorkspace kitId={id} />;
}
