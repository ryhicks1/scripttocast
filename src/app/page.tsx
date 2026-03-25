import { createClient } from "@/lib/supabase/server";
import SmartCreator from "@/components/SmartCreator";
import Link from "next/link";
import { Upload, Sparkles, ClipboardCopy, FileText, Users, Video, HelpCircle, BookmarkCheck, Library, RefreshCw, Cloud } from "lucide-react";

export default async function Home() {
  let isLoggedIn = false;
  let userEmail = "";
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) { isLoggedIn = true; userEmail = user.email || ""; }
  } catch {}

  return (
    <div className="min-h-screen bg-white text-[#1a1a2e]">
      {/* Nav */}
      <nav className="bg-[#1a1a2e] px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-white font-bold text-lg">Script To Cast</Link>
        <div className="flex items-center gap-4 text-sm">
          {isLoggedIn ? (
            <>
              <Link href="/dashboard" className="text-gray-300 hover:text-white">Dashboard</Link>
              <span className="text-gray-400">{userEmail}</span>
            </>
          ) : (
            <>
              <Link href="/login" className="text-gray-300 hover:text-white">Login</Link>
              <Link href="/signup" className="bg-[#00BFA5] text-white px-4 py-1.5 rounded-lg font-semibold text-xs hover:bg-[#00A08A]">Sign Up</Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="bg-gradient-to-b from-[#1a1a2e] to-[#0f0f1e] text-white text-center py-20 px-6">
        <h1 className="text-5xl md:text-6xl font-bold mb-4 tracking-tight">
          Script To <span className="text-[#00BFA5]">Cast</span>
        </h1>
        <h2 className="text-xl md:text-2xl text-gray-300 mb-4 font-medium">
          From script to casting setup in 60 seconds
        </h2>
        <p className="text-gray-400 text-base max-w-2xl mx-auto mb-10 leading-relaxed">
          Upload your casting documents — scripts, self-tape briefs, job info sheets — and AI extracts everything you need to set up your project on Casting Networks.
        </p>
        <a href="#tool" className="inline-flex items-center gap-2 bg-[#00BFA5] text-white px-8 py-3 rounded-xl font-semibold text-sm hover:bg-[#00A08A] transition shadow-lg shadow-[#00BFA5]/20">
          Try It Free <span className="text-lg">↓</span>
        </a>
      </section>

      {/* How It Works */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <h3 className="text-center text-xs uppercase tracking-widest text-gray-400 mb-10 font-semibold">How It Works</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: <Upload className="text-[#00BFA5]" size={28} />, step: "1", title: "Upload", desc: "Drop your scripts, self-tape docs, or job briefs. PDF and DOCX supported." },
            { icon: <Sparkles className="text-[#00BFA5]" size={28} />, step: "2", title: "AI Analyzes", desc: "AI reads your documents and extracts project details, roles, self-tape instructions, and form questions." },
            { icon: <ClipboardCopy className="text-[#00BFA5]" size={28} />, step: "3", title: "Copy & Create", desc: "Copy any field with one click. Paste directly into Casting Networks. Check off roles as you go." },
          ].map((s) => (
            <div key={s.step} className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center hover:shadow-md transition">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[#00BFA5]/10 mx-auto mb-4">{s.icon}</div>
              <div className="text-[10px] text-[#00BFA5] font-bold uppercase tracking-wider mb-1">Step {s.step}</div>
              <h4 className="text-lg font-semibold mb-2 text-[#1a1a2e]">{s.title}</h4>
              <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What You Get */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-4xl mx-auto px-6">
          <h3 className="text-center text-xs uppercase tracking-widest text-gray-400 mb-10 font-semibold">What You Get</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {[
              { icon: <FileText className="text-[#00BFA5]" size={20} />, title: "Project Details", desc: "Project name, brand, type, location, director, dates — all extracted and ready to copy." },
              { icon: <Users className="text-[#00BFA5]" size={20} />, title: "Roles", desc: "Every character including non-speaking. Descriptions, age ranges, gender, characteristics." },
              { icon: <Video className="text-[#00BFA5]" size={20} />, title: "Self-Tape Instructions", desc: "Video labels, shot descriptions, photo requirements, filming notes. Download as PDF." },
              { icon: <HelpCircle className="text-[#00BFA5]" size={20} />, title: "Job Form Questions", desc: "Custom questions extracted from your briefs. Standard fields always included." },
            ].map((f) => (
              <div key={f.title} className="bg-white border border-gray-200 rounded-xl p-5 flex gap-4 hover:shadow-md transition">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#00BFA5]/10 shrink-0">{f.icon}</div>
                <div>
                  <h4 className="text-sm font-semibold mb-1 text-[#1a1a2e]">{f.title}</h4>
                  <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo Preview */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h3 className="text-center text-xs uppercase tracking-widest text-gray-400 mb-10 font-semibold">Example Output</h3>
        <div className="bg-[#1a1a2e] rounded-2xl p-6 space-y-5 text-white shadow-xl">
          <div>
            <div className="text-[10px] text-[#00BFA5] uppercase tracking-wider font-bold mb-2">Project</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-[#252547] rounded-lg px-3 py-2"><span className="text-[9px] text-gray-400 block">Name</span>Nutra Naturals Campaign</div>
              <div className="bg-[#252547] rounded-lg px-3 py-2"><span className="text-[9px] text-gray-400 block">Type</span>Commercial</div>
              <div className="bg-[#252547] rounded-lg px-3 py-2"><span className="text-[9px] text-gray-400 block">Location</span>Sydney</div>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#00BFA5] uppercase tracking-wider font-bold mb-2">Roles (2 extracted)</div>
            <div className="space-y-2">
              <div className="bg-[#252547] border border-[#333366] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold">Hero Woman</span>
                  <span className="text-[8px] px-2 py-0.5 rounded font-semibold uppercase bg-emerald-900/50 text-emerald-400">Speaking</span>
                </div>
                <p className="text-[11px] text-gray-400">Lead female, 25-40. Confident mover, subtle acting ability. Natural warmth and comedic timing.</p>
              </div>
              <div className="bg-[#252547] border border-[#333366] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold">Barista</span>
                  <span className="text-[8px] px-2 py-0.5 rounded font-semibold uppercase bg-blue-900/50 text-blue-400">Non-speaking</span>
                </div>
                <p className="text-[11px] text-gray-400">Friendly cafe worker, any gender, 20s-30s. Serves bone broth in hero shot.</p>
              </div>
            </div>
          </div>
          <div className="text-center pt-2">
            <a href="#tool" className="inline-flex items-center gap-2 text-[#00BFA5] text-sm font-semibold hover:underline">
              Try it yourself ↓
            </a>
          </div>
        </div>
      </section>

      {/* Why Sign Up */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-3xl mx-auto px-6">
          <h3 className="text-center text-xs uppercase tracking-widest text-gray-400 mb-10 font-semibold">Why Sign Up</h3>
          <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
            <ul className="space-y-4">
              {[
                { icon: <BookmarkCheck size={18} className="text-[#00BFA5]" />, text: "Save your projects and access them anytime" },
                { icon: <Library size={18} className="text-[#00BFA5]" />, text: "Build a library of analyzed scripts" },
                { icon: <RefreshCw size={18} className="text-[#00BFA5]" />, text: "Re-analyze with updated documents" },
                { icon: <Cloud size={18} className="text-[#00BFA5]" />, text: "Export to Google Drive or Dropbox (coming soon)" },
              ].map((b) => (
                <li key={b.text} className="flex items-center gap-3 text-sm text-[#1a1a2e]">{b.icon}{b.text}</li>
              ))}
            </ul>
            {!isLoggedIn && (
              <div className="text-center mt-8">
                <Link href="/signup" className="inline-flex items-center gap-2 bg-[#00BFA5] text-white px-8 py-3 rounded-xl font-semibold text-sm hover:bg-[#00A08A] transition">
                  Sign Up Free
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Tool Section */}
      <section id="tool" className="bg-[#1a1a2e] py-16">
        <div className="max-w-4xl mx-auto px-6">
          <h3 className="text-center text-white text-xl font-bold mb-8">Try It Now</h3>
          <SmartCreator isLoggedIn={isLoggedIn} />
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0f0f1e] text-gray-500 text-center py-6 text-xs">
        Script To Cast — AI-powered casting setup tool
      </footer>
    </div>
  );
}
