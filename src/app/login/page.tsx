import { currentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";

export default async function LoginPage() {
  if (await currentUser()) redirect("/dashboard");
  return <AuthForm />;
}
