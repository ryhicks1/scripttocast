import { createClient } from "@/lib/supabase/server";
import SmartCreator from "@/components/SmartCreator";
import Link from "next/link";
import { Upload, Sparkles, ClipboardCopy, FileText, Users, Video, ListChecks } from "lucide-react";

export default async function Home() {
  let isLoggedIn = false;
  let userEmail = "";
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) { isLoggedIn = true; userEmail = user.email || ""; }
  } catch {}

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg text-gray-900">Script To Cast</Link>
        <div className="flex items-center gap-3 text-sm">
          {isLoggedIn ? (
            <>
              <Link href="/dashboard" className="text-gray-500 hover:text-gray-900">Dashboard</Link>
              <span className="text-gray-400 text-xs">{userEmail}</span>
            </>
          ) : (
            <>
              <Link href="/login" className="text-gray-500 hover:text-gray-900">Login</Link>
              <Link href="/signup" className="bg-gray-900 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-800">Sign Up</Link>
            </>
          )}
        </div>
      </nav>

      {/* Tool FIRST */}
      <section id="tool" className="bg-white border-b border-gray-200 py-12">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Set up your casting project in 60 seconds</h2>
          <p className="text-gray-500 text-sm text-center mb-8">Upload scripts and self-tape briefs. AI extracts roles, instructions, and form questions.</p>
          <SmartCreator isLoggedIn={isLoggedIn} />
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-center text-xs text-gray-400 uppercase tracking-wider mb-8 font-medium">How it works</p>
        <div className="grid grid-cols-3 gap-8 text-center">
          {[
            { icon: <Upload size={20} />, title: "Upload", desc: "Scripts, self-tape docs, job briefs" },
            { icon: <Sparkles size={20} />, title: "AI extracts", desc: "Roles, instructions, form questions" },
            { icon: <ClipboardCopy size={20} />, title: "Copy & paste", desc: "Into Casting Networks or anywhere" },
          ].map(s => (
            <div key={s.title}>
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3 text-gray-600">{s.icon}</div>
              <p className="text-sm font-semibold text-gray-900">{s.title}</p>
              <p className="text-xs text-gray-500 mt-1">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What you get */}
      <section className="bg-gray-50 border-y border-gray-200 py-12">
        <div className="max-w-3xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { icon: <FileText size={18} />, label: "Project details" },
              { icon: <Users size={18} />, label: "Roles & descriptions" },
              { icon: <Video size={18} />, label: "Self-tape instructions" },
              { icon: <ListChecks size={18} />, label: "Form questions" },
            ].map(f => (
              <div key={f.label}>
                <div className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center mx-auto mb-2 text-gray-500">{f.icon}</div>
                <p className="text-xs text-gray-600 font-medium">{f.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Example output */}
      <section className="max-w-2xl mx-auto px-6 py-16">
        <p className="text-center text-xs text-gray-400 uppercase tracking-wider mb-6 font-medium">Example output</p>
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4 text-sm">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Project</p>
            <p className="font-semibold text-gray-900">Sunshine Cola — Summer TVC</p>
            <p className="text-xs text-gray-500">Commercial · Sydney · Dir. Alex Park</p>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">Roles</p>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 font-semibold mt-0.5">SPEAKING</span>
                <div>
                  <p className="font-medium text-gray-900 text-xs">JAKE</p>
                  <p className="text-xs text-gray-500">Male, 20s. Laid-back surfer type. Effortlessly cool, dry humor. Lead role.</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-semibold mt-0.5">NON-SPEAK</span>
                <div>
                  <p className="font-medium text-gray-900 text-xs">BEACH EXTRAS</p>
                  <p className="text-xs text-gray-500">Any gender, 18-35. Athletic builds. Beach volleyball scene.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Self-tape instruction</p>
            <p className="text-xs text-gray-500"><strong className="text-gray-700">SLATE:</strong> Mid-shot to camera. Name, agent, height, availability.</p>
            <p className="text-xs text-gray-500"><strong className="text-gray-700">SCENE:</strong> React to tasting the cola for the first time. Keep it natural.</p>
          </div>
        </div>
      </section>

      {/* Sign up prompt */}
      {!isLoggedIn && (
        <section className="bg-gray-50 border-t border-gray-200 py-10 text-center">
          <p className="text-sm text-gray-600 mb-1">Save your projects and access them anytime</p>
          <p className="text-xs text-gray-400 mb-4">Free account. No credit card required.</p>
          <Link href="/signup" className="bg-gray-900 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-gray-800">Sign Up Free</Link>
        </section>
      )}

      <footer className="text-center text-xs text-gray-400 py-6">Script To Cast</footer>
    </div>
  );
}
