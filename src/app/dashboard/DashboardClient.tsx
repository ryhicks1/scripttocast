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
        <Film className="mx-auto mb-4 text-gray-300" size={48} />
        <p className="text-gray-400">No projects yet</p>
        <Link href="/#tool" className="text-[#00BFA5] text-sm hover:underline mt-2 inline-block">Analyze your first script →</Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {projects.map(p => {
        const roleCount = p.data?.roles?.length || 0;
        const date = new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        return (
          <div key={p.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between hover:border-gray-300 transition shadow-sm">
            <div className="flex-1 min-w-0">
              <Link href={`/dashboard/${p.id}`} className="text-sm font-semibold text-gray-900 hover:text-[#00BFA5] transition">{p.name}</Link>
              <p className="text-xs text-gray-400 mt-0.5">{roleCount} roles · {date}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => handleDelete(p.id, p.name)} className="text-gray-300 hover:text-red-400 p-1" title="Delete">
                <Trash2 size={14} />
              </button>
              <Link href={`/dashboard/${p.id}`} className="text-gray-300 hover:text-gray-600 p-1">
                <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
