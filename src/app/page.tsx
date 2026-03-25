import { createClient } from "@/lib/supabase/server";
import SmartCreator from "@/components/SmartCreator";
import Link from "next/link";

export default async function Home() {
  let isLoggedIn = false;
  let userEmail = "";
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) { isLoggedIn = true; userEmail = user.email || ""; }
  } catch {}

  return (
    <div>
      <nav className="border-b border-[#1E2128] px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-[#C9A84C] font-bold text-lg">Script To Cast</Link>
        <div className="flex items-center gap-4 text-sm">
          {isLoggedIn ? (
            <>
              <Link href="/dashboard" className="text-[#8B8D93] hover:text-[#E8E3D8]">Dashboard</Link>
              <span className="text-[#8B8D93]">{userEmail}</span>
            </>
          ) : (
            <>
              <Link href="/login" className="text-[#8B8D93] hover:text-[#E8E3D8]">Login</Link>
              <Link href="/signup" className="bg-[#C9A84C] text-[#0A0B0F] px-4 py-1.5 rounded-lg font-semibold text-xs hover:opacity-90">Sign Up</Link>
            </>
          )}
        </div>
      </nav>

      <section className="max-w-3xl mx-auto text-center py-16 px-6">
        <h1 className="text-4xl md:text-5xl font-bold text-[#C9A84C] mb-4">Script To Cast</h1>
        <h2 className="text-xl md:text-2xl text-[#E8E3D8] mb-3">Upload your casting documents. Get everything you need in seconds.</h2>
        <p className="text-[#8B8D93] text-sm max-w-xl mx-auto mb-8">
          AI-powered project setup for casting professionals. Extract roles, self-tape instructions, job forms, and more from your scripts and briefs.
        </p>
        <a href="#tool" className="inline-flex items-center gap-2 text-[#C9A84C] text-sm hover:underline">
          Get Started <span className="text-lg">↓</span>
        </a>
      </section>

      <section id="tool" className="max-w-4xl mx-auto px-6 pb-20">
        <SmartCreator isLoggedIn={isLoggedIn} />
      </section>
    </div>
  );
}
