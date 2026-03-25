import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface Branding {
  companyName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactWebsite: string | null;
  brandColor: string;
  brandColorRgb: [number, number, number];
  headerText: string | null;
  footerText: string | null;
  logoBase64: string | null;
  logoBytes: Uint8Array | null;
  logoFormat: "png" | "jpeg" | null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

export function textColorForBg(rgb: [number, number, number]): [number, number, number] {
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.5 ? [0, 0, 0] : [255, 255, 255];
}

export async function getUserBranding(userId: string): Promise<Branding> {
  const defaults: Branding = {
    companyName: "Script To Cast",
    contactEmail: null,
    contactPhone: null,
    contactWebsite: null,
    brandColor: "#00BFA5",
    brandColorRgb: [0, 191, 165],
    headerText: null,
    footerText: null,
    logoBase64: null,
    logoBytes: null,
    logoFormat: null,
  };

  try {
    const { data } = await supabaseAdmin
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (!data) return defaults;

    const color = data.brand_color || "#00BFA5";
    const branding: Branding = {
      companyName: data.company_name || "Script To Cast",
      contactEmail: data.contact_email || null,
      contactPhone: data.contact_phone || null,
      contactWebsite: data.contact_website || null,
      brandColor: color,
      brandColorRgb: hexToRgb(color),
      headerText: data.header_text || null,
      footerText: data.footer_text || null,
      logoBase64: null,
      logoBytes: null,
      logoFormat: null,
    };

    if (data.logo_path) {
      try {
        const { data: urlData } = supabaseAdmin.storage.from("logos").getPublicUrl(data.logo_path);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(urlData.publicUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          const buffer = await res.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const mime = res.headers.get("content-type") || "";
          const format = mime.includes("png") ? "png" : "jpeg";
          const base64 = Buffer.from(buffer).toString("base64");
          branding.logoBase64 = `data:${mime};base64,${base64}`;
          branding.logoBytes = bytes;
          branding.logoFormat = format;
        }
      } catch {
        // Logo fetch failed — continue without it
      }
    }

    return branding;
  } catch {
    return defaults;
  }
}
