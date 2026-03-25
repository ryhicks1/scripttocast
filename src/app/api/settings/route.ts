import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("user_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json(data || {
    company_name: "",
    contact_email: "",
    contact_phone: "",
    contact_website: "",
    brand_color: "#00BFA5",
    header_text: "",
    footer_text: "",
    logo_path: null,
  });
}

export async function PUT(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const settings = {
    user_id: user.id,
    company_name: body.company_name || null,
    contact_email: body.contact_email || null,
    contact_phone: body.contact_phone || null,
    contact_website: body.contact_website || null,
    brand_color: body.brand_color || "#00BFA5",
    header_text: body.header_text || null,
    footer_text: body.footer_text || null,
    logo_path: body.logo_path || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("user_settings")
    .upsert(settings, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
