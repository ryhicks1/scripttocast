import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DashboardClient from "./DashboardClient";
import LogoutButton from "@/components/LogoutButton";

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: projects, error } = await supabase
    .from("s2c_projects")
    .select("id, name, data, documents, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Without this, a failed read renders an empty dashboard — telling users
  // their saved projects are gone when the table simply could not be read.
  if (error) console.error("dashboard: failed to load projects", error);

  return (
    <div>
      <nav className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-[#00BFA5] font-bold text-lg">Script To Cast</Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/#tool" className="text-[#00BFA5] text-xs font-semibold bg-[#00BFA5]/10 px-3 py-1.5 rounded-lg hover:bg-[#00BFA5]/20">+ New Analysis</Link>
          <Link href="/settings" className="text-gray-400 text-xs hover:text-gray-600">Settings</Link>
          <span className="text-gray-400 text-xs">{user.email}</span>
          <LogoutButton />
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-xl font-bold mb-6">Your Projects</h1>
        {error ? (
          <div className="border border-amber-200 bg-amber-50 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-900">Couldn&apos;t load your projects</p>
            <p className="text-xs text-amber-800 mt-1">
              Your saved projects are still there — we just couldn&apos;t reach them right now. Try reloading in a moment.
            </p>
          </div>
        ) : (
          <DashboardClient projects={projects || []} />
        )}
      </div>
    </div>
  );
}
