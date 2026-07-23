import { openAIChat } from "../llm/providers/openai";
import { parseClassifierResponse } from "./classifier";

export interface OutputGuardrailResult {
    content: string; // always safe to show — either untouched, redacted, or a refusal
    action: "none" | "redacted" | "refused";
    reason?: string;
}

const SAFE_REFUSAL_MESSAGE =
    "I can't include that in this response — it would involve impersonating an authority, " +
    "granting unauthorized access, or exposing credentials that shouldn't be shared.";

// Real credential-shaped strings — matched generically (not just this app's
// own secrets) since a malicious or leaked credential could in principle
// arrive via an ingested document, not just this app's own env vars.
const SECRET_PATTERNS: RegExp[] = [
    /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI-style API keys
    /AKIA[0-9A-Z]{16}/g, // AWS access key id
    /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s]*:[^\s]*@[^\s]+/gi, // conn strings with embedded creds
    /\b(api[_-]?key|secret[_-]?key|access[_-]?token|password)\s*[:=]\s*['"]?[A-Za-z0-9\-_]{8,}['"]?/gi,
];

// Rejects the assistant's own claimed identity/authority or access-granting
// language — distinct from input.ts's rules, which catch the *user* asking
// for these things, not the *assistant* producing them.
const REFUSAL_TRIGGER_PATTERNS: { category: "impersonation" | "unauthorized-access"; pattern: string }[] = [
    { category: "impersonation", pattern: "i am the system administrator" },
    { category: "impersonation", pattern: "i am the administrator" },
    { category: "impersonation", pattern: "as the administrator, i" },
    { category: "impersonation", pattern: "i am root" },
    { category: "impersonation", pattern: "speaking as the admin" },
    { category: "unauthorized-access", pattern: "here is the admin password" },
    { category: "unauthorized-access", pattern: "i'll bypass" },
    { category: "unauthorized-access", pattern: "i will bypass" },
    { category: "unauthorized-access", pattern: "you now have admin access" },
    { category: "unauthorized-access", pattern: "granting you admin" },
    { category: "unauthorized-access", pattern: "i can grant you access" },
];

const CLASSIFIER_SYSTEM_PROMPT =
    "You are the output guardrail classifier for a RAG system, reviewing the ASSISTANT's " +
    "response before it reaches the user. Default to ACCEPTED. " +
    "Only return REJECTED if the response clearly falls into one of these categories: " +
    "(1) impersonation — the assistant claims to BE a specific real person, an admin, " +
    "root, or another system/authority it isn't; " +
    "(2) unauthorized access — the assistant grants, implies, or explains how to obtain " +
    "elevated/admin access, or how to bypass authentication or security controls; " +
    "(3) secret/credential leakage — the response contains what looks like a real API key, " +
    "password, private key, or connection string as a SYSTEM OR THIRD-PARTY credential. " +
    "Quoting or summarizing information from the user's own indexed documents — including " +
    "personal details like names, emails, phone numbers, employers, or dates — is NORMAL " +
    "and must be ACCEPTED; that is the entire purpose of this app. Only reject for the " +
    "three categories above. " +
    "Respond with ONLY a single-line JSON object, no markdown, no prose, in exactly this " +
    'shape: {"verdict": "accepted" | "rejected", "reason": "<short reason>"}';

function getConfiguredSecrets(): string[] {
    return [process.env.OPENAI_API_KEY, process.env.QDRANT_API_KEY, process.env.REDIS_URL].filter(
        (value): value is string => typeof value === "string" && value.length >= 12,
    );
}

function redactSecrets(text: string): { content: string; redacted: boolean } {
    let content = text;
    let redacted = false;

    for (const secret of getConfiguredSecrets()) {
        if (content.includes(secret)) {
            content = content.split(secret).join("[redacted]");
            redacted = true;
        }
    }

    for (const pattern of SECRET_PATTERNS) {
        const before = content;
        content = content.replace(pattern, "[redacted]");
        if (content !== before) redacted = true;
    }

    return { content, redacted };
}

function checkRefusalTriggers(text: string): string[] {
    const normalized = text.toLowerCase();
    return [...new Set(REFUSAL_TRIGGER_PATTERNS.filter((r) => normalized.includes(r.pattern)).map((r) => r.category))];
}

export async function outputGuardRails(response: string): Promise<OutputGuardrailResult> {
    // 1. Deterministic secret redaction always applies first, regardless of
    // what happens next — a real credential must never reach the user even
    // if everything else about the response is fine.
    const { content: afterRedaction, redacted } = redactSecrets(response);

    // 2. Deterministic refusal-trigger rules (assistant impersonation /
    // access-granting phrasing) — these can't be cleanly redacted as a
    // substring without leaving a broken sentence, so they fall back to a
    // full safe refusal instead.
    const triggeredCategories = checkRefusalTriggers(afterRedaction);
    if (triggeredCategories.length) {
        return {
            content: SAFE_REFUSAL_MESSAGE,
            action: "refused",
            reason: `blocked by rules: ${triggeredCategories.join(", ")}`,
        };
    }

    // 3. Mini-LLM classifier as defense in depth.
    let raw: string;
    try {
        raw = await openAIChat("gpt-4o-mini", afterRedaction, CLASSIFIER_SYSTEM_PROMPT);
    } catch {
        // Fail closed: same as input guardrails — an unreachable classifier
        // must not silently let an unreviewed response through.
        return { content: SAFE_REFUSAL_MESSAGE, action: "refused", reason: "guardrail classifier unavailable" };
    }

    const parsed = parseClassifierResponse(raw);
    if (!parsed) {
        return {
            content: SAFE_REFUSAL_MESSAGE,
            action: "refused",
            reason: "guardrail classifier returned an unparseable response",
        };
    }

    if (parsed.verdict === "rejected") {
        return { content: SAFE_REFUSAL_MESSAGE, action: "refused", reason: parsed.reason };
    }

    return {
        content: afterRedaction,
        action: redacted ? "redacted" : "none",
        reason: redacted ? "a secret-shaped pattern was redacted from the response" : undefined,
    };
}
