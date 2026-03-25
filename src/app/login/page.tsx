"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); }
    else router.push("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="block text-center text-[#C9A84C] font-bold text-2xl mb-8">Script To Cast</Link>
        <form onSubmit={handleSubmit} className="bg-[#13151A] border border-[#1E2128] rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-center">Log In</h2>
          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-3 py-2 bg-[#0A0B0F] border border-[#2A2D35] rounded-lg text-sm" />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full px-3 py-2 bg-[#0A0B0F] border border-[#2A2D35] rounded-lg text-sm" />
          <button type="submit" disabled={loading} className="w-full py-2.5 bg-[#C9A84C] text-[#0A0B0F] rounded-lg font-semibold text-sm disabled:opacity-50">
            {loading ? "Logging in..." : "Log In"}
          </button>
          <p className="text-xs text-center text-[#8B8D93]">
            No account? <Link href="/signup" className="text-[#C9A84C]">Sign up</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
