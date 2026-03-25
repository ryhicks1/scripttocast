"use client";
import { useState, useRef } from "react";
import { Upload, Copy, Check, ChevronDown, ChevronRight, FileDown, RotateCcw, Sparkles, Download } from "lucide-react";

interface Role {
  name: string;
  description: string;
  ageRange?: string;
  gender?: string;
  speaking: boolean;
  characteristics?: string[];
}
interface SelfTapeInstruction {
  roleName: string;
  videos: { label: string; description: string }[];
  photos: string[];
  filmingNotes: string[];
}
interface FormQuestion {
  roleName: string;
  questions: { type: string; label: string; options?: string[]; required: boolean }[];
}
interface AnalysisResult {
  project: { name: string; brand: string; type: string; location?: string; director?: string; castingDirector?: string; productionDates?: string; deadline?: string };
  roles: Role[];
  selfTapeInstructions: SelfTapeInstruction[];
  formQuestions: FormQuestion[];
  projectId?: string;
}

export default function SmartCreator({ isLoggedIn, initialResult }: { isLoggedIn: boolean; initialResult?: AnalysisResult }) {
  const [stage, setStage] = useState<"upload" | "analyzing" | "results">(initialResult ? "results" : "upload");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(initialResult || null);
  const [doneRoles, setDoneRoles] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [sections, setSections] = useState({ roles: true, instructions: true, forms: true });
  const fileRef = useRef<HTMLInputElement>(null);

  const [opts, setOpts] = useState({ project: true, roles: true, instructions: true, forms: true });

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  function CopyBtn({ text, id, label = "Copy" }: { text: string; id: string; label?: string }) {
    return (
      <button
        onClick={() => copyText(text, id)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition shrink-0 ${
          copied === id
            ? "bg-green-900/50 text-green-400"
            : "bg-[#1E2128] text-[#00BFA5] hover:bg-[#2A2D35]"
        }`}
      >
        {copied === id ? <Check size={10} /> : <Copy size={10} />}
        {copied === id ? "Copied" : label}
      </button>
    );
  }

  function addFiles(newFiles: File[]) {
    const valid = newFiles.filter(f => /\.(pdf|docx?)$/i.test(f.name));
    setFiles(prev => [...prev, ...valid]);
  }

  async function analyze() {
    if (!files.length) return;
    setStage("analyzing");
    setError("");
    try {
      const formData = new FormData();
      files.forEach(f => formData.append("files", f));
      formData.append("options", JSON.stringify(opts));

      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Analysis failed");
      }
      const data = await res.json();
      setResult(data);
      setStage("results");
    } catch (err: any) {
      setError(err.message);
      setStage("upload");
    }
  }

  function toggleDone(i: number) {
    setDoneRoles(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function copyEverything() {
    if (!result) return;
    const p = result.project;
    let text = `PROJECT: ${p.name}\nBrand: ${p.brand}\nType: ${p.type}\nLocation: ${p.location || "N/A"}\nDirector: ${p.director || "N/A"}\nDates: ${p.productionDates || "N/A"}\n\n`;
    text += "ROLES:\n" + result.roles.map(r =>
      `${r.name} (${r.speaking ? "Speaking" : "Non-speaking"})${r.ageRange ? ` | Age: ${r.ageRange}` : ""}${r.gender ? ` | ${r.gender}` : ""}\n${r.description}`
    ).join("\n\n");
    if (result.selfTapeInstructions?.length) {
      text += "\n\nSELF-TAPE INSTRUCTIONS:\n" + result.selfTapeInstructions.map(st =>
        `${st.roleName}:\n${st.videos.map(v => `  ${v.label}: ${v.description}`).join("\n")}${st.photos?.length ? "\n  Photos: " + st.photos.join(", ") : ""}${st.filmingNotes?.length ? "\n  Notes: " + st.filmingNotes.join("; ") : ""}`
      ).join("\n\n");
    }
    if (result.formQuestions?.length) {
      text += "\n\nFORM QUESTIONS:\n" + result.formQuestions.map(fq =>
        `${fq.roleName}:\n${fq.questions.map(q => `  - ${q.label} (${q.type})`).join("\n")}`
      ).join("\n\n");
    }
    copyText(text, "everything");
  }

  function downloadReport() {
    if (!result) return;
    const p = result.project;
    const lines: string[] = [];
    lines.push("=".repeat(60));
    lines.push("SCRIPT TO CAST — PROJECT REPORT");
    lines.push("=".repeat(60));
    lines.push("");
    lines.push("PROJECT DETAILS");
    lines.push("-".repeat(40));
    lines.push(`Name: ${p.name}`);
    if (p.brand) lines.push(`Brand: ${p.brand}`);
    if (p.type) lines.push(`Type: ${p.type.replace(/_/g, " ")}`);
    if (p.location) lines.push(`Location: ${p.location}`);
    if (p.director) lines.push(`Director: ${p.director}`);
    if (p.castingDirector) lines.push(`Casting Director: ${p.castingDirector}`);
    if (p.productionDates) lines.push(`Production Dates: ${p.productionDates}`);
    if (p.deadline) lines.push(`Deadline: ${p.deadline}`);
    lines.push("");

    if (result.roles?.length) {
      lines.push("ROLES");
      lines.push("-".repeat(40));
      result.roles.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.name} (${r.speaking ? "Speaking" : "Non-speaking"})`);
        lines.push(`   ${r.description}`);
        if (r.ageRange) lines.push(`   Age: ${r.ageRange}`);
        if (r.gender) lines.push(`   Gender: ${r.gender}`);
        if (r.characteristics?.length) lines.push(`   Characteristics: ${r.characteristics.join(", ")}`);
        lines.push("");
      });
    }

    if (result.selfTapeInstructions?.length) {
      lines.push("SELF-TAPE INSTRUCTIONS");
      lines.push("-".repeat(40));
      result.selfTapeInstructions.forEach((st) => {
        lines.push(`Role: ${st.roleName}`);
        st.videos.forEach((v) => {
          lines.push(`  ${v.label}: ${v.description}`);
        });
        if (st.photos?.length) {
          lines.push(`  Photos: ${st.photos.join(", ")}`);
        }
        if (st.filmingNotes?.length) {
          lines.push("  Filming Notes:");
          st.filmingNotes.forEach((n, k) => lines.push(`    ${k + 1}. ${n}`));
        }
        lines.push("");
      });
    }

    if (result.formQuestions?.length) {
      lines.push("JOB FORM QUESTIONS");
      lines.push("-".repeat(40));
      lines.push("Standard fields always included: Full Name, Email, Phone, Location, Agent");
      lines.push("");
      result.formQuestions.forEach((fq) => {
        lines.push(`Role: ${fq.roleName}`);
        fq.questions.forEach((q) => {
          lines.push(`  - ${q.label} (${q.type})${q.required ? " *required" : ""}`);
          if (q.options?.length) lines.push(`    Options: ${q.options.join(", ")}`);
        });
        lines.push("");
      });
    }

    lines.push("=".repeat(60));
    lines.push("Generated by Script To Cast");
    lines.push("=".repeat(60));

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.name.replace(/[^a-zA-Z0-9]+/g, "_")}_Report.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() { setStage("upload"); setFiles([]); setResult(null); setDoneRoles(new Set()); setError(""); }

  function toggleSection(key: keyof typeof sections) {
    setSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  // ========== UPLOAD STAGE ==========
  if (stage === "upload") return (
    <div>
      <div
        className="border-2 border-dashed border-[#2A2D35] rounded-xl p-10 text-center cursor-pointer hover:border-[#00BFA5] transition mb-4"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("border-[#00BFA5]"); }}
        onDragLeave={e => e.currentTarget.classList.remove("border-[#00BFA5]")}
        onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("border-[#00BFA5]"); addFiles(Array.from(e.dataTransfer.files)); }}
      >
        <Upload className="mx-auto mb-3 text-[#8B8D93]" size={32} />
        <p className="text-[#8B8D93] text-sm">Drop your casting documents here</p>
        <p className="text-[#555] text-xs mt-1">PDF or DOCX — scripts, self-tape docs, job info</p>
        <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.doc" className="hidden" onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <div className="space-y-1 mb-4">
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between bg-[#13151A] border border-[#1E2128] rounded-lg px-3 py-2 text-xs">
              <span className="truncate">{f.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-[#555]">{(f.size / 1024).toFixed(0)}KB</span>
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 mb-6">
        <p className="text-[10px] text-[#8B8D93] uppercase tracking-wider font-semibold">What should we extract?</p>
        {[
          { key: "project" as const, label: "Project Details" },
          { key: "roles" as const, label: "Roles (including non-speaking)" },
          { key: "instructions" as const, label: "Self-Tape Instructions" },
          { key: "forms" as const, label: "Job Form Questions" },
        ].map(o => (
          <label key={o.key} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={opts[o.key]} onChange={() => setOpts(prev => ({ ...prev, [o.key]: !prev[o.key] }))} className="accent-[#00BFA5]" />
            {o.label}
          </label>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      <button
        onClick={analyze}
        disabled={!files.length}
        className="w-full py-3 bg-[#00BFA5] text-[#1a1a2e] rounded-lg font-semibold text-sm disabled:opacity-40 hover:opacity-90 transition flex items-center justify-center gap-2"
      >
        <Sparkles size={16} /> Analyze Documents
      </button>
    </div>
  );

  // ========== ANALYZING STAGE ==========
  if (stage === "analyzing") return (
    <div className="text-center py-20">
      <div className="w-10 h-10 border-3 border-[#1E2128] border-t-[#00BFA5] rounded-full animate-spin mx-auto mb-4" />
      <p className="text-[#E8E3D8]">AI is analyzing your documents...</p>
      <p className="text-[#555] text-xs mt-2">This usually takes 10-30 seconds</p>
    </div>
  );

  // ========== RESULTS STAGE ==========
  if (!result) return null;
  const p = result.project;

  return (
    <div className="space-y-4">
      {/* Project Details */}
      <div className="bg-[#13151A] border border-[#1E2128] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#00BFA5]">🎬 PROJECT DETAILS</h3>
          <CopyBtn text={`${p.name}\n${p.brand}\n${p.type}\n${p.location || ""}\n${p.director || ""}\n${p.productionDates || ""}`} id="project-all" label="Copy All" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: "Name", value: p.name },
            { label: "Brand", value: p.brand },
            { label: "Type", value: p.type?.replace(/_/g, " ") },
            { label: "Location", value: p.location },
            { label: "Director", value: p.director },
            { label: "Casting Director", value: p.castingDirector },
            { label: "Production Dates", value: p.productionDates },
            { label: "Deadline", value: p.deadline },
          ].filter(f => f.value).map(f => (
            <div key={f.label} className="flex items-center justify-between bg-[#1a1a2e] rounded-lg px-3 py-2">
              <div>
                <div className="text-[9px] text-[#8B8D93] uppercase">{f.label}</div>
                <div className="text-xs">{f.value}</div>
              </div>
              <CopyBtn text={f.value!} id={`p-${f.label}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Roles */}
      <div className="bg-[#13151A] border border-[#1E2128] rounded-xl p-5">
        <button onClick={() => toggleSection("roles")} className="flex items-center justify-between w-full mb-3">
          <h3 className="text-sm font-semibold text-[#00BFA5]">
            🎭 ROLES ({doneRoles.size}/{result.roles.length} done)
          </h3>
          {sections.roles ? <ChevronDown size={14} className="text-[#8B8D93]" /> : <ChevronRight size={14} className="text-[#8B8D93]" />}
        </button>
        {sections.roles && (
          <div className="space-y-2">
            {result.roles.map((r, i) => (
              <div key={i} className={`bg-[#1a1a2e] border border-[#1E2128] rounded-lg p-3 transition ${doneRoles.has(i) ? "opacity-40" : ""}`}>
                <div className="flex items-center gap-2 mb-1">
                  <input type="checkbox" checked={doneRoles.has(i)} onChange={() => toggleDone(i)} className="accent-green-400" />
                  <span className={`text-xs font-semibold flex-1 ${doneRoles.has(i) ? "line-through" : ""}`}>{r.name}</span>
                  <span className={`text-[8px] px-2 py-0.5 rounded font-semibold uppercase ${r.speaking ? "bg-green-900/50 text-green-400" : "bg-blue-900/50 text-blue-400"}`}>
                    {r.speaking ? "Speaking" : "Non-speaking"}
                  </span>
                </div>
                <p className="text-[11px] text-[#9ca3af] mb-1">{r.description}</p>
                {(r.ageRange || r.gender) && (
                  <p className="text-[10px] text-[#8B8D93]">{[r.ageRange && `Age: ${r.ageRange}`, r.gender].filter(Boolean).join(" | ")}</p>
                )}
                <div className="flex gap-1 mt-2">
                  <CopyBtn text={r.name} id={`r-${i}-name`} label="Name" />
                  <CopyBtn text={r.description} id={`r-${i}-desc`} label="Desc" />
                  <CopyBtn text={`${r.name}\n${r.description}\n${r.ageRange ? "Age: " + r.ageRange : ""}${r.gender ? " | " + r.gender : ""}`} id={`r-${i}-all`} label="All" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Self-Tape Instructions */}
      {result.selfTapeInstructions?.length > 0 && (
        <div className="bg-[#13151A] border border-[#1E2128] rounded-xl p-5">
          <button onClick={() => toggleSection("instructions")} className="flex items-center justify-between w-full mb-3">
            <h3 className="text-sm font-semibold text-[#00BFA5]">🎬 SELF-TAPE INSTRUCTIONS</h3>
            {sections.instructions ? <ChevronDown size={14} className="text-[#8B8D93]" /> : <ChevronRight size={14} className="text-[#8B8D93]" />}
          </button>
          {sections.instructions && (
            <div className="space-y-3">
              {result.selfTapeInstructions.map((st, i) => {
                const allText = st.videos.map(v => `${v.label}: ${v.description}`).join("\n") +
                  (st.photos?.length ? "\n\nPhotos:\n" + st.photos.join("\n") : "") +
                  (st.filmingNotes?.length ? "\n\nFilming Notes:\n" + st.filmingNotes.join("\n") : "");
                return (
                  <div key={i} className="bg-[#1a1a2e] border border-[#1E2128] rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold">{st.roleName}</span>
                      <div className="flex gap-1">
                        <CopyBtn text={allText} id={`st-${i}-all`} label="Copy All" />
                        <button
                          onClick={() => downloadPdf(st, p)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-[#1E2128] text-[#8B8D93] hover:bg-[#2A2D35]"
                        >
                          <FileDown size={10} /> PDF
                        </button>
                      </div>
                    </div>
                    {st.videos.map((v, j) => (
                      <div key={j} className="mb-2">
                        <p className="text-[10px] font-semibold text-[#E8E3D8]">{v.label}</p>
                        <p className="text-[11px] text-[#9ca3af]">{v.description}</p>
                      </div>
                    ))}
                    {st.photos?.length > 0 && (
                      <div className="mb-2">
                        <p className="text-[10px] font-semibold text-[#E8E3D8]">Photos</p>
                        <p className="text-[11px] text-[#9ca3af]">{st.photos.join(", ")}</p>
                      </div>
                    )}
                    {st.filmingNotes?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-[#E8E3D8]">Filming Notes</p>
                        <ol className="text-[11px] text-[#9ca3af] list-decimal list-inside">
                          {st.filmingNotes.map((n, k) => <li key={k}>{n}</li>)}
                        </ol>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Form Questions */}
      {result.formQuestions?.length > 0 && (
        <div className="bg-[#13151A] border border-[#1E2128] rounded-xl p-5">
          <button onClick={() => toggleSection("forms")} className="flex items-center justify-between w-full mb-3">
            <h3 className="text-sm font-semibold text-[#00BFA5]">📋 JOB FORM QUESTIONS</h3>
            {sections.forms ? <ChevronDown size={14} className="text-[#8B8D93]" /> : <ChevronRight size={14} className="text-[#8B8D93]" />}
          </button>
          {sections.forms && (
            <div className="space-y-3">
              <p className="text-[10px] text-[#8B8D93]">Standard fields always included: Full Name, Email, Phone, Location, Agent</p>
              {result.formQuestions.map((fq, i) => (
                <div key={i} className="bg-[#1a1a2e] border border-[#1E2128] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold">{fq.roleName}</span>
                    <CopyBtn text={fq.questions.map(q => q.label).join("\n")} id={`fq-${i}`} label="Copy All" />
                  </div>
                  {fq.questions.map((q, j) => (
                    <div key={j} className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#1E2128] text-[#8B8D93] uppercase font-mono">{q.type}</span>
                      <span className="text-[11px] text-[#9ca3af] flex-1">{q.label}</span>
                      <CopyBtn text={q.label} id={`fq-${i}-${j}`} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom Actions */}
      <div className="sticky bottom-0 bg-[#1a1a2e]/90 backdrop-blur border-t border-[#1E2128] py-3 flex items-center gap-2 flex-wrap">
        <button onClick={copyEverything} className="flex items-center gap-1.5 px-4 py-2 bg-[#00BFA5] text-[#1a1a2e] rounded-lg text-xs font-semibold hover:opacity-90">
          <Copy size={12} /> {copied === "everything" ? "Copied!" : "Copy Everything"}
        </button>
        <button onClick={downloadReport} className="flex items-center gap-1.5 px-4 py-2 bg-[#1E2128] text-[#E8E3D8] rounded-lg text-xs font-semibold hover:bg-[#2A2D35]">
          <Download size={12} /> Download Report
        </button>
        <button onClick={reset} className="flex items-center gap-1.5 px-4 py-2 bg-[#1E2128] text-[#8B8D93] rounded-lg text-xs hover:bg-[#2A2D35]">
          <RotateCcw size={12} /> Start Over
        </button>
        {!isLoggedIn && (
          <a href="/signup" className="ml-auto flex items-center gap-1.5 px-4 py-2 border border-[#00BFA5] text-[#00BFA5] rounded-lg text-xs font-semibold hover:bg-[#00BFA5]/10">
            Sign up to save projects
          </a>
        )}
        {isLoggedIn && result.projectId && (
          <span className="ml-auto text-xs text-green-400 flex items-center gap-1"><Check size={12} /> Saved to your projects</span>
        )}
      </div>
    </div>
  );
}

async function downloadPdf(st: SelfTapeInstruction, project: AnalysisResult["project"]) {
  const res = await fetch("/api/generate-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...st, projectName: project.name, brand: project.brand, location: project.location, productionDates: project.productionDates }),
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Self-Tape_${st.roleName.replace(/\s+/g, "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
