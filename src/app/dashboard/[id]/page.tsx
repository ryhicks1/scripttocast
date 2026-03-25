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
      <nav className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-[#00BFA5] font-bold text-lg">Script To Cast</Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-900 text-xs">← Dashboard</Link>
          <Link href="/settings" className="text-gray-400 text-xs hover:text-gray-600">Settings</Link>
          <span className="text-gray-400 text-xs">{user.email}</span>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-xl font-bold mb-2">{project.name}</h1>
        <p className="text-xs text-gray-400 mb-6">
          Created {new Date(project.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>

        {/* Documents */}
        {project.documents?.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Attached Documents</h3>
            <div className="space-y-1">
              {project.documents.map((doc: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-700">
                  <span>{doc.name}</span>
                  {doc.url && <a href={doc.url} target="_blank" rel="noopener" className="text-[#00BFA5] hover:underline">Download</a>}
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
