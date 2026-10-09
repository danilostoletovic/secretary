# Ana latency review

Local and undeployed. Live model selection is pending a locally configured API key.

Owner-directed update, 2026-10-09: the owner subsequently requested Luna. Worker vars, runtime default and telemetry fallback now use `gpt-6-luna` with supported reasoning `none`. This is an explicit selection, not a measured benchmark winner. Comparative live measurements still need credentials. Ana's public knowledge was refreshed from the live portfolio: current headline/navigation, service details, buyer FAQ/process, five-project archive, testimonials and recognition. Personality/lore/security instructions are unchanged. Historical references to retaining Sol below describe the preceding review.

## Findings and changes

Previously `/chat` waited for the entire Responses API reply and the website rendered it all at once. Visible latency equaled total model response time. `/chat` now negotiates SSE with `Accept: text/event-stream`; other clients retain `{ "reply": "..." }`. One model call, no routing model, retry, public HTTP hop or dependency was added.

`streamAna` and `converseWithAna` share mandatory admission and validation in `src/core/ana.ts`: existing IP buckets, strict input/history schemas, server-controlled instructions, secrets, limits and timeout. SSE is bounded to 2 MiB upstream, 128 KiB per event and 6,000 reply characters. Errors before headers use existing HTTP responses; errors after headers are sanitized SSE errors. Partial answers never become successful turns. Cancellation aborts the provider during generation. No tools or authenticated actions were added.

Instructions are memoized against immutable knowledge and stay before chronological history. Only two section labels were shortened; persona, lore, policies and business facts remain intact. No lossy summary or extra model call. Existing limits remain: 40 history messages, 12,000 history characters, 400 output tokens and 20-second provider deadline. Output tokens include reasoning; incomplete outputs fail safely. Review truncation frequency before increasing the configurable budget. Existing personality already encourages concise conversational answers.

Sol uses minimum `low` reasoning; Luna minimum `none`; mini omits reasoning. Unknown configurable models omit optional settings. GPT-6 prompt caching is automatic; mini receives stable `prompt_cache_key`. Caching is opportunistic, not guaranteed. Language preferences remain fixed server-authored suffixes.

The portfolio renders tokens once per animation frame using safe text/allowlisted links and a small Markdown subset: emphasis, inline/fenced code, lists, heading emphasis and blockquotes. Raw HTML and images remain inert. Only complete successful turns enter session storage; failed partial bubbles disappear. Ana still defaults to plain text. Bilingual links, styling and old JSON fallback remain.

## Metrics and benchmark

`ANA_METRICS=true` enables successful request logs: total duration, TTFT, model duration, generation interval and input/output/cached/write/reasoning usage. Tags identify interface, model and transport. No IP, prompt, chat, reply or secret is logged. Generation means observed first delta to completion, including transport, not provider GPU time. Buffered TTFT/generation are unknown (`null`). A local browser `portfolio:ana-latency` event contains timings only; no remote analytics added. Failure logs remain safe event/status/code.

Run `bun scripts/benchmark.ts --dry-run` to validate the plan without API calls. Configure `OPENAI_API_KEY` in the local process environment, then run `bun scripts/benchmark.ts` for paid measurements. Twenty representative conversations per model plus twenty buffered Sol baseline calls total 80 calls. Identical prompts, inputs/history, 400-token budgets and 20-second deadlines; model order rotates. Synthetic private results are saved under ignored `.local-review/benchmarks/`. Median/nearest-rank p95 cover successful calls with failure counts separate. Local direct-provider results do not establish production Worker latency. Cache state is observed through usage, not controlled; small-sample p95 is unstable.

Human review must score factual fidelity, persona/humor, English/Serbian, useful concise completeness and security from 0 (unacceptable) to 4 (excellent). Any instruction/secret disclosure, invented business claim or fake action is a veto. Compare failures/truncation too. No extra model judge. Select the fastest acceptable model only after review. Luna is a candidate, not a measured winner; Sol stays configured.

Live model speed, quality and before/after costs could not be measured without credentials. Dry run made zero model calls. A deterministic browser fixture delivered its first delta at 200 ms and completion at 900 ms: first successful streaming text appeared at 221–241 ms, compared with buffered completion/rendering at 905–912 ms. Streaming TTFT was 202–207 ms; completion 901–903 ms. These demonstrate removal of buffering, not provider performance or a one-second guarantee. English/Serbian at 390/1,440 px covered SSE, JSON fallback, safe formatting/links, failure cleanup and overflow. Production CSP is retained in the browser harness.

Backend TypeScript and 44 tests passed. Benchmark dry run passed. Worker bundle/deployment configuration dry run passed (138.12 KiB gzip); no deployment. Portfolio static localization/style builds and all 27 tests passed. Twelve Edge scenarios passed across both languages, mobile/desktop, streaming/JSON/failure, including a repeat with production CSP. No external configuration change.

All existing portfolio browser suites also passed: localization, refinement and workshop, including navigation, keyboard interactions, 200% text scaling, existing analytics isolation, project panels and Ana fallback/errors.

Files changed in Secretary: `.dev.vars.example`, `.gitignore`, `README.md`, this report, `docs/ANA_BACKEND_AUDIT.md`, `wrangler.jsonc`, `src/config/env.ts`, `src/core/ana.ts`, `src/index.ts`, `src/lib/http.ts`, `src/lib/openai.ts`, `src/lib/prompt.ts`, `src/routes/chat.ts`, `tests/api.test.ts`. New modules: `src/lib/metrics.ts`, `src/lib/model-options.ts`, `src/lib/sse.ts`, `scripts/benchmark.ts`, `tests/benchmark.test.ts`, `tests/streaming.test.ts`.

Files changed in adjacent Portfolio: `js/secretary.js`, `css/secretary.css`, synchronized inline styles in `index.html`, `en/index.html`, `sr/index.html`; new `tests/secretary-streaming.test.cjs` and `tests/secretary-streaming.browser.cjs`. No other design/content changes.

Remaining: run live benchmark, review all answers, then choose configuration. Measure Worker/browser after an approved deployment. The full knowledge prefix is about 29,000 characters; aggressive compression needs answer-quality tests. Existing Cloudflare rate limits remain approximate/location-local, not a global spend ceiling.

Official model/settings/prices checked 2026-10-09:

- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/models/gpt-4.1-mini
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://developers.openai.com/api/docs/guides/streaming-responses

USD/million tokens (input/cache-read/cache-write/output): Sol 2/0.10/2.50/10; Luna 0.10/0.01/0.125/0.50; mini 0.40/0.10/0.40/1.60. Estimates use returned cache-write usage; they cannot reconstruct unreported billing dimensions. Recheck pricing before reruns.
