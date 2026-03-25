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
    <div className="min-h-screen flex items-center justify-center px-4 bg-white">
      <div className="w-full max-w-sm">
        <Link href="/" className="block text-center text-[#00BFA5] font-bold text-2xl mb-8">Script To Cast</Link>
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4 shadow-sm">
          <h2 className="text-lg font-semibold text-center text-gray-900">Log In</h2>
          {error && <p className="text-red-500 text-xs text-center">{error}</p>}
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#00BFA5]" />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#00BFA5]" />
          <button type="submit" disabled={loading} className="w-full py-2.5 bg-gray-900 text-white rounded-lg font-semibold text-sm disabled:opacity-50 hover:bg-gray-800 transition">
            {loading ? "Logging in..." : "Log In"}
          </button>
          <p className="text-xs text-center text-gray-500">
            No account? <Link href="/signup" className="text-[#00BFA5] font-medium">Sign up</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
