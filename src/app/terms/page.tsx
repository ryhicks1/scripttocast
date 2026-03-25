import Link from "next/link";

export const metadata = { title: "Terms of Use — Script To Cast" };

export default function TermsOfUse() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 px-6 py-4">
        <Link href="/" className="text-[#00BFA5] font-bold text-lg">Script To Cast</Link>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Terms of Use</h1>
        <p className="text-sm text-gray-400 mb-8">Last updated: March 25, 2026</p>

        <div className="space-y-8 text-sm text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">About the Service</h2>
            <p>
              Script To Cast is an AI-powered casting breakdown tool. It analyzes screenplays and
              casting documents to extract character information, role descriptions, and related
              metadata. By using Script To Cast, you agree to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Your Content and Ownership</h2>
            <p className="mb-3">
              You retain full ownership of all scripts, documents, and materials you upload to
              Script To Cast. We claim no intellectual property rights over your content. Uploading
              a script does not grant us any license to use, reproduce, distribute, or display
              your content beyond what is necessary to provide the analysis service.
            </p>
            <p>
              By uploading content, you represent that you have the legal right to do so — either
              because you own the material, or because you have authorization from the rights
              holder to use it for casting purposes.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">How AI Analysis Works</h2>
            <p className="mb-3">
              Script To Cast uses Anthropic&apos;s Claude AI to analyze uploaded documents. Your
              script text is sent to Anthropic&apos;s API during analysis. Under Anthropic&apos;s
              API terms, this data is not used for AI model training.
            </p>
            <p>
              AI-generated analysis results (character breakdowns, role descriptions, casting
              metadata) are produced automatically and may contain errors, omissions, or
              inaccuracies. You are responsible for reviewing and verifying all output before
              using it in a professional context. Script To Cast does not guarantee the accuracy
              or completeness of AI-generated results.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Confidentiality</h2>
            <p>
              We recognize that scripts and casting materials are often confidential. Raw script
              content is processed in memory only and is not permanently stored on our servers.
              We do not access, review, or share your uploaded content or analysis results.
              Saved projects are stored with row-level security so that only you can access
              your own data.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Acceptable Use</h2>
            <p className="mb-3">You agree not to:</p>
            <ul className="list-disc list-inside space-y-2 pl-1">
              <li>Upload content you do not have the right to use.</li>
              <li>Attempt to extract, reverse-engineer, or circumvent the AI analysis system.</li>
              <li>Use the service to infringe on the intellectual property rights of others.</li>
              <li>Share your account credentials with others or allow unauthorized access.</li>
              <li>Use the service for any unlawful purpose.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Account and Termination</h2>
            <p>
              You may delete your account and all associated data at any time. We reserve the
              right to suspend or terminate accounts that violate these terms. If your account
              is terminated, all stored data will be permanently deleted.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Limitation of Liability</h2>
            <p>
              Script To Cast is provided &ldquo;as is&rdquo; without warranties of any kind,
              express or implied. To the maximum extent permitted by law, Script To Cast shall
              not be liable for any indirect, incidental, special, or consequential damages
              arising from your use of the service, including but not limited to loss of data,
              loss of revenue, or unauthorized disclosure of content.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Changes to These Terms</h2>
            <p>
              We may update these terms from time to time. Material changes will be communicated
              via the email address associated with your account. Continued use of the service
              after changes constitutes acceptance of the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Contact</h2>
            <p>
              Questions about these terms? Contact us at{" "}
              <a href="mailto:support@scripttocast.com" className="text-[#00BFA5] hover:underline">
                support@scripttocast.com
              </a>.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-gray-100 text-xs text-gray-400">
          <Link href="/privacy" className="hover:text-gray-600 transition">Privacy Policy</Link>
        </div>
      </div>
    </div>
  );
}
