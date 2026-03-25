import Link from "next/link";

export const metadata = { title: "Privacy Policy — Script To Cast" };

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 px-6 py-4">
        <Link href="/" className="text-[#00BFA5] font-bold text-lg">Script To Cast</Link>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-400 mb-8">Last updated: March 25, 2026</p>

        <div className="space-y-8 text-sm text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">What Script To Cast Does</h2>
            <p>
              Script To Cast is an AI-powered tool that analyzes screenplays and casting documents to
              extract character breakdowns, role descriptions, and casting information. We understand
              that the scripts you upload may be confidential, unpublished material. This policy
              explains exactly how we handle your data.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">How Your Scripts Are Processed</h2>
            <p className="mb-3">
              When you upload a script for analysis, the following happens:
            </p>
            <ol className="list-decimal list-inside space-y-2 pl-1">
              <li>Your script file is read in your browser and sent to our server for processing.</li>
              <li>The text content is sent to Anthropic&apos;s Claude API for AI-powered analysis.</li>
              <li>The AI extracts structured data: character names, descriptions, age ranges, and page numbers.</li>
              <li>Only the extracted results are returned to you. The raw script text is not stored on our servers.</li>
            </ol>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">What We Store</h2>
            <ul className="list-disc list-inside space-y-2 pl-1">
              <li><strong>Your email address</strong> and account credentials (password is hashed and managed by our authentication provider, Supabase).</li>
              <li><strong>Extracted analysis results</strong> (character names, descriptions, casting metadata) if you save a project to your dashboard.</li>
            </ul>
            <p className="mt-3">
              We do <strong>not</strong> store your raw script text, uploaded PDF files, or the full
              content of your documents on our servers. Script content exists only in memory during
              the analysis process and is discarded immediately after.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Third-Party AI Processing</h2>
            <p className="mb-3">
              Script text is sent to Anthropic&apos;s Claude API for analysis. Under Anthropic&apos;s
              API terms, data submitted through the API is <strong>not used to train their AI
              models</strong>. Anthropic may retain API inputs for a limited period for trust and
              safety purposes, as described in their usage policy.
            </p>
            <p>
              We encourage you to review{" "}
              <a href="https://www.anthropic.com/policies/privacy" className="text-[#00BFA5] hover:underline" target="_blank" rel="noopener noreferrer">
                Anthropic&apos;s Privacy Policy
              </a>{" "}
              for full details on how they handle API data.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Your Rights and Data Deletion</h2>
            <p>
              You can delete any saved project from your dashboard at any time. If you wish to
              delete your account entirely, you may do so from your account settings and all
              associated data will be permanently removed. You may also contact us to request
              complete account deletion.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">What We Don&apos;t Do</h2>
            <ul className="list-disc list-inside space-y-2 pl-1">
              <li>We do not sell, share, or distribute your scripts or analysis results to any third party.</li>
              <li>We do not use your scripts to train any AI model.</li>
              <li>We do not show your data to other users of the platform.</li>
              <li>We do not use tracking cookies or third-party analytics that can identify you.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Infrastructure and Security</h2>
            <p>
              Script To Cast is hosted on Vercel. Authentication and database services are provided
              by Supabase with row-level security, meaning users can only access their own data.
              All data is transmitted over encrypted HTTPS connections.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. Material changes will be communicated
              via the email address associated with your account. Continued use of the service
              after changes constitutes acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Contact</h2>
            <p>
              If you have questions about this policy or how your data is handled, contact us
              at{" "}
              <a href="mailto:privacy@scripttocast.com" className="text-[#00BFA5] hover:underline">
                privacy@scripttocast.com
              </a>.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-gray-100 text-xs text-gray-400">
          <Link href="/terms" className="hover:text-gray-600 transition">Terms of Use</Link>
        </div>
      </div>
    </div>
  );
}
