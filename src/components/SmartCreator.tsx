"use client";
import { useState, useRef } from "react";
import { Upload, Copy, Check, ChevronDown, ChevronRight, FileDown, RotateCcw, Sparkles, Download } from "lucide-react";

interface Role { name: string; description: string; ageRange?: string; gender?: string; speaking: boolean; characteristics?: string[]; }
interface SelfTapeInstruction { roleName: string; videos: { label: string; description: string }[]; photos: string[]; filmingNotes: string[]; }
interface FormQuestion { roleName: string; questions: { type: string; label: string; options?: string[]; required: boolean }[]; }
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
    const done = copied === id;
    return (
      <button onClick={() => copyText(text, id)} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition shrink-0 ${done ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
        {done ? <Check size={10} /> : <Copy size={10} />}
        {done ? "Copied" : label}
      </button>
    );
  }

  function addFiles(newFiles: File[]) {
    setFiles(prev => [...prev, ...newFiles.filter(f => /\.(pdf|docx?)$/i.test(f.name))]);
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
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Analysis failed"); }
      const data = await res.json();
      setResult(data);
      setStage("results");
    } catch (err: any) { setError(err.message); setStage("upload"); }
  }

  function toggleDone(i: number) {
    setDoneRoles(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }

  function copyEverything() {
    if (!result) return;
    const p = result.project;
    let t = `PROJECT: ${p.name}\nBrand: ${p.brand}\nType: ${p.type}\nLocation: ${p.location || "N/A"}\nDirector: ${p.director || "N/A"}\nDates: ${p.productionDates || "N/A"}\n\nROLES:\n`;
    t += result.roles.map(r => `${r.name} (${r.speaking ? "Speaking" : "Non-speaking"})${r.ageRange ? ` | Age: ${r.ageRange}` : ""}${r.gender ? ` | ${r.gender}` : ""}\n${r.description}`).join("\n\n");
    if (result.selfTapeInstructions?.length) {
      t += "\n\nSELF-TAPE INSTRUCTIONS:\n" + result.selfTapeInstructions.map(st =>
        `${st.roleName}:\n${st.videos.map(v => `  ${v.label}: ${v.description}`).join("\n")}${st.photos?.length ? "\n  Photos: " + st.photos.join(", ") : ""}${st.filmingNotes?.length ? "\n  Notes: " + st.filmingNotes.join("; ") : ""}`
      ).join("\n\n");
    }
    if (result.formQuestions?.length) {
      t += "\n\nFORM QUESTIONS:\n" + result.formQuestions.map(fq => `${fq.roleName}:\n${fq.questions.map(q => `  - ${q.label} (${q.type})`).join("\n")}`).join("\n\n");
    }
    copyText(t, "everything");
  }

  function downloadReport() {
    if (!result) return;
    const p = result.project;
    const l: string[] = [];
    l.push("=" .repeat(50), "SCRIPT TO CAST — PROJECT REPORT", "=".repeat(50), "", "PROJECT", "-".repeat(30));
    l.push(`Name: ${p.name}`);
    if (p.brand) l.push(`Brand: ${p.brand}`);
    if (p.type) l.push(`Type: ${p.type.replace(/_/g, " ")}`);
    if (p.location) l.push(`Location: ${p.location}`);
    if (p.director) l.push(`Director: ${p.director}`);
    if (p.productionDates) l.push(`Dates: ${p.productionDates}`);
    l.push("");
    if (result.roles?.length) {
      l.push("ROLES", "-".repeat(30));
      result.roles.forEach((r, i) => { l.push(`${i+1}. ${r.name} (${r.speaking?"Speaking":"Non-speaking"})`); l.push(`   ${r.description}`); if (r.ageRange) l.push(`   Age: ${r.ageRange}`); if (r.gender) l.push(`   Gender: ${r.gender}`); l.push(""); });
    }
    if (result.selfTapeInstructions?.length) {
      l.push("SELF-TAPE INSTRUCTIONS", "-".repeat(30));
      result.selfTapeInstructions.forEach(st => { l.push(`Role: ${st.roleName}`); st.videos.forEach(v => l.push(`  ${v.label}: ${v.description}`)); if (st.photos?.length) l.push(`  Photos: ${st.photos.join(", ")}`); if (st.filmingNotes?.length) { l.push("  Filming Notes:"); st.filmingNotes.forEach((n,k) => l.push(`    ${k+1}. ${n}`)); } l.push(""); });
    }
    if (result.formQuestions?.length) {
      l.push("FORM QUESTIONS", "-".repeat(30));
      result.formQuestions.forEach(fq => { l.push(`Role: ${fq.roleName}`); fq.questions.forEach(q => l.push(`  - ${q.label} (${q.type})${q.required?" *":""}`)); l.push(""); });
    }
    const blob = new Blob([l.join("\n")], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${p.name.replace(/[^a-zA-Z0-9]+/g, "_")}_Report.txt`; a.click();
  }

  function copyCNProjectScript() {
    if (!result) return;
    const p = result.project;
    const typeMap: Record<string, string> = {
      commercial: "26", film: "51", feature_film: "51", tv_series: "28", short_film: "50",
      music_video: "17", web_series: "27", theatre: "11", vertical_short: "428",
    };
    const typeVal = typeMap[p.type] || "";
    const script = `// Script To Cast — Auto-fill CN Project
(function(){
  const inputs = document.querySelectorAll('input[type="text"]');
  const selects = document.querySelectorAll('select');
  function fill(el, val) {
    if (!el || !val) return;
    const s = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
    if (s) { s.call(el, val); } else { el.value = val; }
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }
  if (inputs[0]) fill(inputs[0], ${JSON.stringify(p.name)});
  if (selects[0] && ${JSON.stringify(typeVal)}) { selects[0].value = ${JSON.stringify(typeVal)}; selects[0].dispatchEvent(new Event('change',{bubbles:true})); }
  if (selects[2]) { selects[2].value = "2"; selects[2].dispatchEvent(new Event('change',{bubbles:true})); }
  if (inputs[1]) fill(inputs[1], "TBD");
  console.log("✅ Project filled: ${p.name.replace(/"/g, '')}");
})();`;
    copyText(script, "cn-project");
  }

  function copyCNRoleScript(roleIndex: number) {
    if (!result || !result.roles[roleIndex]) return;
    const r = result.roles[roleIndex];
    const script = `// Script To Cast — Auto-fill CN Role: ${r.name}
(function(){
  function fill(el, val) {
    if (!el || !val) return;
    const s = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
    if (s) { s.call(el, val); } else { el.value = val; }
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }
  const inputs = document.querySelectorAll('input[type="text"]');
  const textareas = document.querySelectorAll('textarea');
  // Try to fill role name
  for (const inp of inputs) {
    const lbl = (inp.getAttribute('aria-label')||inp.placeholder||'').toLowerCase();
    if (lbl.includes('role') || lbl.includes('character') || lbl.includes('name')) {
      fill(inp, ${JSON.stringify(r.name)});
      break;
    }
  }
  // Try to fill description
  for (const ta of textareas) {
    const lbl = (ta.getAttribute('aria-label')||ta.placeholder||'').toLowerCase();
    if (lbl.includes('desc') || lbl.includes('note') || lbl.includes('detail')) {
      fill(ta, ${JSON.stringify(r.description)});
      break;
    }
  }
  console.log("✅ Role filled: ${r.name.replace(/"/g, '')}");
})();`;
    copyText(script, `cn-role-${roleIndex}`);
  }

  function reset() { setStage("upload"); setFiles([]); setResult(null); setDoneRoles(new Set()); setError(""); }
  function toggleSection(k: keyof typeof sections) { setSections(p => ({ ...p, [k]: !p[k] })); }

  // ========== UPLOAD ==========
  if (stage === "upload") return (
    <div>
      <div
        className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-gray-400 transition mb-4 bg-gray-50"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("border-gray-500", "bg-gray-100"); }}
        onDragLeave={e => { e.currentTarget.classList.remove("border-gray-500", "bg-gray-100"); }}
        onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("border-gray-500", "bg-gray-100"); addFiles(Array.from(e.dataTransfer.files)); }}
      >
        <Upload className="mx-auto mb-3 text-gray-400" size={28} />
        <p className="text-gray-500 text-sm">Drop your casting documents here</p>
        <p className="text-gray-400 text-xs mt-1">PDF or DOCX — scripts, self-tape docs, job briefs</p>
        <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.doc" className="hidden" onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <div className="space-y-1 mb-4">
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700">
              <span className="truncate">{f.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">{(f.size / 1024).toFixed(0)}KB</span>
                <button onClick={() => setFiles(p => p.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 mb-6">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">What should we extract?</p>
        {[
          { key: "project" as const, label: "Project Details" },
          { key: "roles" as const, label: "Roles (including non-speaking)" },
          { key: "instructions" as const, label: "Self-Tape Instructions" },
          { key: "forms" as const, label: "Job Form Questions" },
        ].map(o => (
          <label key={o.key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={opts[o.key]} onChange={() => setOpts(p => ({ ...p, [o.key]: !p[o.key] }))} className="accent-gray-900 w-4 h-4" />
            {o.label}
          </label>
        ))}
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <button onClick={analyze} disabled={!files.length} className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium text-sm disabled:opacity-30 hover:bg-gray-800 transition flex items-center justify-center gap-2">
        <Sparkles size={16} /> Analyze Documents
      </button>
    </div>
  );

  // ========== ANALYZING ==========
  if (stage === "analyzing") return (
    <div className="text-center py-16">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto mb-4" />
      <p className="text-gray-700 font-medium">Analyzing your documents...</p>
      <p className="text-gray-400 text-xs mt-1">Usually takes 10-30 seconds</p>
    </div>
  );

  // ========== RESULTS ==========
  if (!result) return null;
  const p = result.project;

  return (
    <div className="space-y-4">
      {/* Project */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Project Details</h3>
          <CopyBtn text={Object.values(p).filter(Boolean).join("\n")} id="p-all" label="Copy All" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { l: "Name", v: p.name }, { l: "Brand", v: p.brand }, { l: "Type", v: p.type?.replace(/_/g, " ") },
            { l: "Location", v: p.location }, { l: "Director", v: p.director }, { l: "CD", v: p.castingDirector },
            { l: "Dates", v: p.productionDates }, { l: "Deadline", v: p.deadline },
          ].filter(f => f.v).map(f => (
            <div key={f.l} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
              <div><div className="text-[9px] text-gray-400 uppercase">{f.l}</div><div className="text-xs text-gray-800">{f.v}</div></div>
              <CopyBtn text={f.v!} id={`p-${f.l}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Roles */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <button onClick={() => toggleSection("roles")} className="flex items-center justify-between w-full mb-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Roles — {doneRoles.size}/{result.roles.length} done
          </h3>
          {sections.roles ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        </button>
        {sections.roles && (
          <div className="space-y-2">
            {result.roles.map((r, i) => (
              <div key={i} className={`bg-gray-50 border border-gray-200 rounded-lg p-3 transition ${doneRoles.has(i) ? "opacity-30" : ""}`}>
                <div className="flex items-center gap-2 mb-1">
                  <input type="checkbox" checked={doneRoles.has(i)} onChange={() => toggleDone(i)} className="accent-green-600 w-3.5 h-3.5" />
                  <span className={`text-xs font-semibold text-gray-900 flex-1 ${doneRoles.has(i) ? "line-through" : ""}`}>{r.name}</span>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded font-semibold uppercase ${r.speaking ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"}`}>
                    {r.speaking ? "Speaking" : "Non-speaking"}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mb-1">{r.description}</p>
                {(r.ageRange || r.gender) && <p className="text-[10px] text-gray-400">{[r.ageRange && `Age: ${r.ageRange}`, r.gender].filter(Boolean).join(" · ")}</p>}
                <div className="flex gap-1 mt-2">
                  <CopyBtn text={r.name} id={`r-${i}-n`} label="Name" />
                  <CopyBtn text={r.description} id={`r-${i}-d`} label="Desc" />
                  <CopyBtn text={`${r.name}\n${r.description}${r.ageRange ? "\nAge: " + r.ageRange : ""}${r.gender ? "\nGender: " + r.gender : ""}`} id={`r-${i}-a`} label="All" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Self-Tape Instructions */}
      {result.selfTapeInstructions?.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <button onClick={() => toggleSection("instructions")} className="flex items-center justify-between w-full mb-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Self-Tape Instructions</h3>
            {sections.instructions ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
          </button>
          {sections.instructions && (
            <div className="space-y-3">
              {result.selfTapeInstructions.map((st, i) => {
                const allText = st.videos.map(v => `${v.label}: ${v.description}`).join("\n") + (st.photos?.length ? "\n\nPhotos:\n" + st.photos.join("\n") : "") + (st.filmingNotes?.length ? "\n\nFilming Notes:\n" + st.filmingNotes.join("\n") : "");
                return (
                  <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-gray-900">{st.roleName}</span>
                      <div className="flex gap-1">
                        <CopyBtn text={allText} id={`st-${i}`} label="Copy All" />
                        <button onClick={() => downloadPdf(st, p)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">
                          <FileDown size={10} /> PDF
                        </button>
                      </div>
                    </div>
                    {st.videos.map((v, j) => (
                      <div key={j} className="mb-2">
                        <p className="text-[10px] font-semibold text-gray-700">{v.label}</p>
                        <p className="text-[11px] text-gray-500">{v.description}</p>
                      </div>
                    ))}
                    {st.photos?.length > 0 && <div className="mb-1"><p className="text-[10px] font-semibold text-gray-700">Photos</p><p className="text-[11px] text-gray-500">{st.photos.join(", ")}</p></div>}
                    {st.filmingNotes?.length > 0 && <div><p className="text-[10px] font-semibold text-gray-700">Filming Notes</p><ol className="text-[11px] text-gray-500 list-decimal list-inside">{st.filmingNotes.map((n, k) => <li key={k}>{n}</li>)}</ol></div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Form Questions */}
      {result.formQuestions?.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <button onClick={() => toggleSection("forms")} className="flex items-center justify-between w-full mb-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Job Form Questions</h3>
            {sections.forms ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
          </button>
          {sections.forms && (
            <div className="space-y-3">
              <p className="text-[10px] text-gray-400">Standard fields always included: Name, Email, Phone, Location, Agent</p>
              {result.formQuestions.map((fq, i) => (
                <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-900">{fq.roleName}</span>
                    <CopyBtn text={fq.questions.map(q => {
                      let line = q.label;
                      if (q.type === "radio" && q.options?.length) line += ` [${q.options.join(" / ")}]`;
                      if (q.required) line += " *";
                      return line;
                    }).join("\n")} id={`fq-${i}`} label="Copy All" />
                    <CopyBtn text={JSON.stringify(fq.questions.map(q => ({
                      type: q.type === "radio" ? "control_radio" : q.type === "textarea" ? "control_textarea" : q.type === "checkbox" ? "control_checkbox" : "control_textbox",
                      text: q.label,
                      required: q.required ? "Yes" : "No",
                      ...(q.options?.length ? { options: q.options.join("|") } : {}),
                    })), null, 2)} id={`fq-${i}-json`} label="JotForm JSON" />
                  </div>
                  {fq.questions.map((q, j) => (
                    <div key={j} className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 uppercase font-mono">{q.type}</span>
                      <span className="text-[11px] text-gray-600 flex-1">{q.label}</span>
                      <CopyBtn text={q.label} id={`fq-${i}-${j}`} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CN Fill Script */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Casting Networks Auto-Fill</h3>
        <p className="text-[11px] text-gray-500 mb-3">
          Copy this script, go to the CN &quot;Create Project&quot; page, open your browser console (F12 → Console), and paste it. It will fill in the project details automatically.
        </p>
        <div className="flex gap-2">
          <button onClick={() => copyCNProjectScript()} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800">
            <Copy size={12} /> {copied === "cn-project" ? "Copied!" : "Copy Project Script"}
          </button>
          <button onClick={() => copyCNRoleScript(0)} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200">
            <Copy size={12} /> {copied?.startsWith("cn-role") ? "Copied!" : "Copy Role Script"}
          </button>
        </div>
        {result.roles.length > 1 && (
          <div className="mt-2 flex gap-1 flex-wrap">
            {result.roles.map((r, i) => (
              <button key={i} onClick={() => copyCNRoleScript(i)} className={`text-[10px] px-2 py-0.5 rounded ${copied === `cn-role-${i}` ? "bg-green-50 text-green-600" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}>
                {r.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-0 bg-white/90 backdrop-blur border-t border-gray-200 py-3 flex items-center gap-2 flex-wrap">
        <button onClick={copyEverything} className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800">
          <Copy size={12} /> {copied === "everything" ? "Copied!" : "Copy Everything"}
        </button>
        <button onClick={downloadReport} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200">
          <Download size={12} /> Download Report
        </button>
        <button onClick={reset} className="flex items-center gap-1.5 px-4 py-2 text-gray-400 text-xs hover:text-gray-600">
          <RotateCcw size={12} /> Start Over
        </button>
        {!isLoggedIn && (
          <a href="/signup" className="ml-auto text-xs text-gray-500 hover:text-gray-900 font-medium">Save this project →</a>
        )}
        {isLoggedIn && result.projectId && (
          <span className="ml-auto text-xs text-green-600 flex items-center gap-1"><Check size={12} /> Saved</span>
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
  const a = document.createElement("a"); a.href = url; a.download = `Self-Tape_${st.roleName.replace(/\s+/g, "_")}.pdf`; a.click();
  URL.revokeObjectURL(url);
}
