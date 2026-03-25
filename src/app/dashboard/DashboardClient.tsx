"use client";
import { useState } from "react";
import Link from "next/link";
import { Trash2, ChevronRight, Film } from "lucide-react";

interface Project {
  id: string;
  name: string;
  data: any;
  documents: any[];
  created_at: string;
}

export default function DashboardClient({ projects: initialProjects }: { projects: Project[] }) {
  const [projects, setProjects] = useState(initialProjects);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) setProjects(prev => prev.filter(p => p.id !== id));
  }

  if (!projects.length) {
    return (
      <div className="text-center py-20">
        <Film className="mx-auto mb-4 text-[#2A2D35]" size={48} />
        <p className="text-[#8B8D93]">No projects yet</p>
        <Link href="/#tool" className="text-[#C9A84C] text-sm hover:underline mt-2 inline-block">Analyze your first script →</Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {projects.map(p => {
        const roleCount = p.data?.roles?.length || 0;
        const date = new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        return (
          <div key={p.id} className="bg-[#13151A] border border-[#1E2128] rounded-xl p-4 flex items-center justify-between hover:border-[#2A2D35] transition">
            <div className="flex-1 min-w-0">
              <Link href={`/dashboard/${p.id}`} className="text-sm font-semibold hover:text-[#C9A84C] transition">{p.name}</Link>
              <p className="text-xs text-[#8B8D93] mt-0.5">{roleCount} roles · {date}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => handleDelete(p.id, p.name)} className="text-[#8B8D93] hover:text-red-400 p-1" title="Delete">
                <Trash2 size={14} />
              </button>
              <Link href={`/dashboard/${p.id}`} className="text-[#8B8D93] hover:text-[#E8E3D8] p-1">
                <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
