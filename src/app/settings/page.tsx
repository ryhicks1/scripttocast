import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import SettingsClient from "./SettingsClient";

export const metadata = { title: "Settings — Script To Cast" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div>
      <nav className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-[#00BFA5] font-bold text-lg">Script To Cast</Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-900 text-xs">Dashboard</Link>
          <span className="text-gray-400 text-xs">{user.email}</span>
          <LogoutButton />
        </div>
      </nav>
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-xl font-bold text-gray-900 mb-6">Settings</h1>
        <SettingsClient userId={user.id} />
      </div>
    </div>
  );
}
