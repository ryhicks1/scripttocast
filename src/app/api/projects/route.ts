import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, data, documents } = await request.json();

  const { data: project, error } = await supabaseAdmin()
    .from("s2c_projects")
    .insert({
      user_id: user.id,
      name: name || data?.project?.name || "Untitled",
      data: data || {},
      documents: documents || [],
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: project.id });
}
