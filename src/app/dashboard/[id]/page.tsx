import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import SmartCreator from "@/components/SmartCreator";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project } = await supabase
    .from("s2c_projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!project) notFound();

  return (
    <div>
      <nav className="border-b border-[#1E2128] px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-[#C9A84C] font-bold text-lg">Script To Cast</Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="text-[#8B8D93] hover:text-[#E8E3D8]">← Dashboard</Link>
          <span className="text-[#8B8D93]">{user.email}</span>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-xl font-bold mb-2">{project.name}</h1>
        <p className="text-xs text-[#8B8D93] mb-6">
          Created {new Date(project.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>

        {/* Documents */}
        {project.documents?.length > 0 && (
          <div className="bg-[#13151A] border border-[#1E2128] rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold text-[#C9A84C] mb-3">📎 Attached Documents</h3>
            <div className="space-y-1">
              {project.documents.map((doc: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-[#0A0B0F] rounded-lg px-3 py-2 text-xs">
                  <span>{doc.name}</span>
                  {doc.url && <a href={doc.url} target="_blank" rel="noopener" className="text-[#C9A84C] hover:underline">Download</a>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results — reuse SmartCreator in results-only mode */}
        <SmartCreator isLoggedIn={true} initialResult={project.data} />
      </div>
    </div>
  );
}
