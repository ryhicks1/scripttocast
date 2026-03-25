import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DashboardClient from "./DashboardClient";

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: projects } = await supabase
    .from("s2c_projects")
    .select("id, name, data, documents, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <nav className="border-b border-[#1E2128] px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-[#C9A84C] font-bold text-lg">Script To Cast</Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/#tool" className="text-[#C9A84C] text-xs font-semibold bg-[#C9A84C]/10 px-3 py-1.5 rounded-lg hover:bg-[#C9A84C]/20">+ New Analysis</Link>
          <span className="text-[#8B8D93]">{user.email}</span>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-xl font-bold mb-6">Your Projects</h1>
        <DashboardClient projects={projects || []} />
      </div>
    </div>
  );
}
