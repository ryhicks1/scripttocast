"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface Settings {
  company_name: string;
  contact_email: string;
  contact_phone: string;
  contact_website: string;
  brand_color: string;
  header_text: string;
  footer_text: string;
  logo_path: string | null;
}

const DEFAULTS: Settings = {
  company_name: "",
  contact_email: "",
  contact_phone: "",
  contact_website: "",
  brand_color: "#00BFA5",
  header_text: "",
  footer_text: "",
  logo_path: null,
};

export default function SettingsClient({ userId }: { userId: string }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then(data => {
        setSettings({ ...DEFAULTS, ...data });
        if (data.logo_path) {
          const supabase = createClient();
          const { data: urlData } = supabase.storage.from("logos").getPublicUrl(data.logo_path);
          setLogoPreview(urlData.publicUrl);
        }
        setLoading(false);
      });
  }, []);

  async function uploadLogo(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      alert("Logo must be under 2MB");
      return;
    }
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      alert("Logo must be PNG or JPEG");
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop();
    const path = `${userId}/logo.${ext}`;

    await supabase.storage.from("logos").remove([path]);
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });

    if (error) {
      alert("Upload failed: " + error.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("logos").getPublicUrl(path);
    setLogoPreview(urlData.publicUrl + "?t=" + Date.now());
    setSettings(s => ({ ...s, logo_path: path }));
    setUploading(false);
  }

  async function removeLogo() {
    if (!settings.logo_path) return;
    const supabase = createClient();
    await supabase.storage.from("logos").remove([settings.logo_path]);
    setSettings(s => ({ ...s, logo_path: null }));
    setLogoPreview(null);
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) return <p className="text-gray-400 text-sm">Loading...</p>;

  return (
    <div className="space-y-8">
      {/* Logo */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Logo</h2>
        <div className="flex items-center gap-4">
          {logoPreview ? (
            <img src={logoPreview} alt="Logo" className="h-16 w-16 object-contain rounded-lg border border-gray-200 bg-gray-50" />
          ) : (
            <div className="h-16 w-16 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-xs">
              No logo
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
            {logoPreview && (
              <button onClick={removeLogo} className="px-3 py-1.5 text-red-500 text-xs hover:underline">
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={e => e.target.files?.[0] && uploadLogo(e.target.files[0])}
          />
        </div>
        <p className="text-[10px] text-gray-400 mt-2">PNG or JPEG, max 2MB. Appears on generated PDFs.</p>
      </section>

      {/* Company Info */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Company Info</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Company / Agency Name</label>
            <input
              value={settings.company_name}
              onChange={e => setSettings(s => ({ ...s, company_name: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-[#00BFA5]"
              placeholder="Acme Casting"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Contact Email</label>
            <input
              value={settings.contact_email}
              onChange={e => setSettings(s => ({ ...s, contact_email: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-[#00BFA5]"
              placeholder="casting@example.com"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Phone</label>
            <input
              value={settings.contact_phone}
              onChange={e => setSettings(s => ({ ...s, contact_phone: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-[#00BFA5]"
              placeholder="+61 400 000 000"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Website</label>
            <input
              value={settings.contact_website}
              onChange={e => setSettings(s => ({ ...s, contact_website: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-[#00BFA5]"
              placeholder="https://example.com"
            />
          </div>
        </div>
      </section>

      {/* Branding */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Branding</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Brand Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={settings.brand_color}
                onChange={e => setSettings(s => ({ ...s, brand_color: e.target.value }))}
                className="h-9 w-14 rounded border border-gray-200 cursor-pointer"
              />
              <span className="text-xs text-gray-400 font-mono">{settings.brand_color}</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">Used for headers and accents on generated PDFs.</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Custom Header Text</label>
            <input
              value={settings.header_text}
              onChange={e => setSettings(s => ({ ...s, header_text: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-[#00BFA5]"
              placeholder="Appears below header on PDFs"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Custom Footer Text</label>
            <input
              value={settings.footer_text}
              onChange={e => setSettings(s => ({ ...s, footer_text: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-[#00BFA5]"
              placeholder="Appears at bottom of PDFs"
            />
          </div>
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
        {saved && <span className="text-xs text-green-600">Settings saved</span>}
      </div>
    </div>
  );
}
