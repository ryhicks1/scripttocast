import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { provider, roleName, projectName, questions } = body as {
      provider: "jotform" | "google";
      roleName: string;
      projectName: string;
      questions: { type: string; label: string; options?: string[]; required?: boolean }[];
    };

    const title = `${roleName} — ${projectName}`;

    if (provider === "jotform") {
      // JotForm Prefill URL — generates a URL that creates a form in the user's account
      // JotForm doesn't support full form creation via URL, but we can:
      // 1. Generate a JotForm-importable JSON
      // 2. Use the JotForm form builder URL with prefilled title
      const jfQuestions: Record<string, any> = {};

      // Standard fields
      let order = 1;
      jfQuestions[String(order)] = { type: "control_head", text: title, order: String(order) };
      order++;
      jfQuestions[String(order)] = { type: "control_fullname", text: "Full Name", required: "Yes", order: String(order) };
      order++;
      jfQuestions[String(order)] = { type: "control_email", text: "Email Address", required: "Yes", order: String(order) };
      order++;
      jfQuestions[String(order)] = { type: "control_phone", text: "Phone Number", required: "No", order: String(order) };
      order++;
      jfQuestions[String(order)] = { type: "control_textbox", text: "City and State", required: "No", order: String(order) };
      order++;
      jfQuestions[String(order)] = { type: "control_textbox", text: "Your Agent/Manager", required: "No", order: String(order) };
      order++;

      // Custom questions from AI
      for (const q of questions) {
        const typeMap: Record<string, string> = {
          text: "control_textbox",
          email: "control_email",
          phone: "control_phone",
          textarea: "control_textarea",
          radio: "control_radio",
          checkbox: "control_checkbox",
          select: "control_dropdown",
        };
        const entry: any = {
          type: typeMap[q.type] || "control_textbox",
          text: q.label,
          required: q.required ? "Yes" : "No",
          order: String(order),
        };
        if (q.options?.length) {
          entry.options = q.options.join("|");
        }
        jfQuestions[String(order)] = entry;
        order++;
      }

      // Add submit button
      jfQuestions[String(order)] = { type: "control_button", text: "Submit Application", order: String(order) };

      // Return the importable JSON structure
      return NextResponse.json({
        provider: "jotform",
        title,
        importJson: {
          properties: { title },
          questions: jfQuestions,
        },
        // Human-readable version for copy-paste into JotForm builder
        formattedQuestions: [
          "Full Name (required)",
          "Email Address (required)",
          "Phone Number",
          "City and State",
          "Your Agent/Manager",
          ...questions.map(q => {
            let line = q.label;
            if (q.type === "radio" && q.options?.length) line += ` [${q.options.join(" / ")}]`;
            if (q.required) line += " (required)";
            return line;
          }),
        ],
      });
    }

    if (provider === "google") {
      // Google Forms: create a pre-filled URL
      // Google Forms supports creating forms with a title via URL
      const encodedTitle = encodeURIComponent(title);
      const googleUrl = `https://docs.google.com/forms/create?title=${encodedTitle}`;

      return NextResponse.json({
        provider: "google",
        url: googleUrl,
        title,
        formattedQuestions: [
          "Full Name (required)",
          "Email Address (required)",
          "Phone Number",
          "City and State",
          "Your Agent/Manager",
          ...questions.map(q => {
            let line = q.label;
            if (q.type === "radio" && q.options?.length) line += ` [${q.options.join(" / ")}]`;
            if (q.required) line += " (required)";
            return line;
          }),
        ],
      });
    }

    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  } catch (error: any) {
    console.error("Create form error:", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
