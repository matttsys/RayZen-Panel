/**
 * Shared types for the RayZen platform layer.
 *
 * These types are the contracts between subsystems. They live in `#types/`
 * rather than inside one subsystem so that, for example, diagnostics can consume
 * a `HealthReport` without importing the diagnostics implementation, and the
 * scanner can produce a `ScoredTarget` without the panel importing the scanner.
 *
 * Rule for this file: types only, no runtime values, no imports from `src/`
 * outside `#types/`. That keeps it importable from every layer including the data
 * plane without creating a dependency edge.
 */

/** Severity decides whether an issue blocks a write or only informs the user. */
export type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * One validation finding.
 *
 * `code` is the machine-readable identity and is stable across releases, which is
 * what makes localisation and per-field UI mapping possible. The human-readable
 * `message` remains alongside it for the current UI.
 *
 * `field` is the settings key (e.g. `remoteDNS`), not a display label, so the
 * panel can focus the offending input without string matching.
 */
export interface ValidationIssue {
    code: string;
    field: string;
    /** Display label, retained for compatibility with the existing panel UI. */
    label: string;
    message: string;
    severity: IssueSeverity;
    /** Optional machine-readable detail, e.g. `{ min: 1, max: 65535 }`. */
    context?: Record<string, string | number | boolean>;
}

export interface ValidationResult {
    ok: boolean;
    issues: ValidationIssue[];
}

/** Why a feature is unavailable, so the UI can explain rather than just hide. */
export type FeatureState = 'available' | 'unavailable' | 'degraded';

export interface FeatureStatus {
    id: string;
    title: string;
    state: FeatureState;
    /** Present when state is not `available`. Plain English, user-facing. */
    reason?: string;
    /** Bindings or capabilities the feature needs, for the diagnostics view. */
    requires: readonly string[];
}

export type HistoryKind =
    | 'settings.updated'
    | 'settings.reset'
    | 'panel.updated'
    | 'warp.refreshed'
    | 'scanner.run'
    | 'auth.login'
    /**
     * A subscription link was created, revoked, re-enabled or deleted.
     *
     * Recorded because a link is a standing credential: "this stopped working" is only
     * answerable if revocations are dated. The entry never carries the token, for the
     * reason given at the write site in `src/api/platform.ts`.
     */
    | 'links.changed';

/**
 * One durable audit entry.
 *
 * Deliberately small: an entry is a fact plus a short summary, never a full
 * settings snapshot. Storing snapshots would multiply KV value size by the number
 * of retained entries and would put proxy credentials in a second place.
 */
export interface HistoryEntry {
    id: string;
    kind: HistoryKind;
    /** Epoch milliseconds. */
    at: number;
    /** One-line human summary, already redacted by the producer. */
    summary: string;
    /** Small structured detail. Must contain no secrets. */
    detail?: Record<string, string | number | boolean>;
}

/**
 * Counter identities. A closed union, because an open string space would make the
 * KV value grow without bound and would let a typo create a silent second series.
 */
export type MetricName =
    | 'config.exports'
    | 'config.unsupported'
    | 'auth.success'
    | 'auth.failure'
    | 'settings.saves'
    | 'settings.rejections'
    | 'scanner.probes'
    | 'scanner.healthy'
    | 'warp.refreshes'
    | 'panel.updates'
    | 'recommendation.shown'
    | 'recommendation.accepted'
    | 'recommendation.dismissed'
    | 'optimization.evaluated';

/** Aggregated counters for one UTC day. */
export interface DailyMetrics {
    /** `YYYY-MM-DD`, UTC. */
    day: string;
    counters: Partial<Record<MetricName, number>>;
}

export interface MetricsSnapshot {
    days: DailyMetrics[];
    totals: Partial<Record<MetricName, number>>;
}

/** Derived statistics, computed from a snapshot rather than stored. */
export interface StatisticsSummary {
    /** Sum over the retained window. */
    totals: Partial<Record<MetricName, number>>;
    /** Mean per active day, rounded to one decimal. */
    dailyAverage: Partial<Record<MetricName, number>>;
    /** Successful auth attempts as a fraction of all attempts, or null if none. */
    authSuccessRate: number | null;
    /** Supported exports as a fraction of all export attempts, or null if none. */
    exportSuccessRate: number | null;
    /** Days with at least one recorded event. */
    activeDays: number;
    /** Most recent day present in the snapshot, or null when empty. */
    lastActiveDay: string | null;
    /** Accepted recommendations as a fraction of accepted + dismissed outcomes. */
    recommendationAcceptanceRate?: number | null;
}

export interface AnalyticsInsight {
    id: string;
    title: string;
    detail: string;
    action: string;
    severity: 'info' | 'attention' | 'positive';
}


export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface DiagnosticFinding {
    /** Stable identity, e.g. `security.password-set`. */
    id: string;
    title: string;
    status: CheckStatus;
    /** Why this status, in plain English. Safe to show a user verbatim. */
    detail: string;
    /** Contribution weight when scoring. 0 excludes the check from the score. */
    weight: number;
    /** Optional pointer to the settings field or docs section that fixes it. */
    remediation?: string;
}

export interface HealthReport {
    /** 0-100. Weighted pass rate across the checks that ran. */
    score: number;
    grade: 'excellent' | 'good' | 'fair' | 'poor';
    findings: DiagnosticFinding[];
    /** Counts by status, for a compact UI summary. */
    tally: Record<CheckStatus, number>;
    /** Epoch milliseconds when the report was produced. */
    at: number;
}

export type RecommendationImpact = 'high' | 'medium' | 'low';

export interface Recommendation {
    id: string;
    title: string;
    /** Why this matters, in plain English. */
    rationale: string;
    impact: RecommendationImpact;
    /** Settings keys the user would change. Lets the panel deep-link a field. */
    fields: readonly string[];
    /**
     * Machine-applicable patch, when the change is unambiguous. Absent when the
     * right value depends on the user's network or threat model, in which case the
     * recommendation informs rather than acts.
     */
    patch?: Record<string, string | number | boolean>;
    /** Auditable evidence for the recommendation; confidence measures evidence quality. */
    evidence?: {
        confidence: number;
        summary: string;
        before?: Record<string, number>;
        after?: Record<string, number>;
        factors: readonly string[];
    };
}

export type OptimizationObjective = 'latency' | 'stability' | 'streaming' | 'gaming' | 'mobile';
export interface OptimizationProfile {
    id: string;
    title: string;
    description: string;
    objective: OptimizationObjective;
    presetId: string;
    priorities: readonly string[];
}
export interface ProfileEvaluation {
    profile: OptimizationProfile;
    compatible: boolean;
    score: number;
    confidence: number;
    changed: string[];
    rationale: string[];
    baselineScore: number | null;
}


/** Who a preset is for. Used to group presets in the UI. */
export type PresetAudience = 'general' | 'restricted-network' | 'performance' | 'privacy' | 'latency' | 'stability' | 'streaming' | 'gaming' | 'mobile';

export interface Preset {
    id: string;
    title: string;
    description: string;
    audience: PresetAudience;
    /**
     * The settings this preset asserts. A partial patch, never a full settings
     * object: applying a preset must not silently revert unrelated fields.
     */
    patch: Record<string, unknown>;
    /** Keys this preset intentionally leaves to the user. */
    preserves: readonly string[];
}

export interface PresetApplication {
    preset: Preset;
    /** Keys whose value would actually change. */
    changed: string[];
    /** The merged settings, ready for validation. */
    result: Record<string, unknown>;
}

export type ScanTargetKind = 'proxy-ip' | 'clean-ip' | 'warp-endpoint';

export interface ScanTarget {
    /** Hostname, IPv4, or bracketed IPv6, optionally with `:port`. */
    address: string;
    kind: ScanTargetKind;
}

/** One probe attempt against one target. */
export interface ProbeAttempt {
    attempt: number;
    ok: boolean;
    elapsedMs: number;
}

/**
 * Why the platform refused to measure an address.
 *
 * Mirrors `UnmeasurableReason` in `@features/scanner/cloudflare`. Declared here so
 * a `ProbeResult` can carry the classification without the type layer importing a
 * feature module, matching the rule that this file holds contracts only.
 */
export type ProbeBlockedReason =
    | 'cloudflare-range'
    | 'cloudflare-host'
    | 'loopback'
    | 'private-network'
    | 'link-local'
    | 'prohibited-port';

/** The raw outcome of probing one target, before scoring. */
export interface ProbeResult {
    target: ScanTarget;
    attempts: ProbeAttempt[];
    /** Successful attempts over total attempts. */
    successes: number;
    total: number;
    /** Mean latency of successful attempts, or null when none succeeded. */
    avgLatencyMs: number | null;
    /** Standard deviation of successful attempt latencies, or null. */
    jitterMs: number | null;
    at: number;
    /**
     * Set when the runtime forbids probing this address, in which case no attempt
     * was made and `successes`/`total` are both zero. Absent for a real probe.
     *
     * This field is the difference between "the endpoint is dead" and "we are not
     * allowed to ask", which for a Cloudflare-optimisation product is the single
     * most consequential distinction the scanner makes.
     */
    blocked?: ProbeBlockedReason;
}

/** A probe result plus its score and the components that produced it. */
export interface ScoredTarget {
    target: ScanTarget;
    /** 0-100. See `src/features/scanner/scoring.ts` for the model. */
    score: number;
    reliability: number;
    latency: number;
    stability: number;
    /**
     * `unmeasurable` is not a quality judgement: it means the Workers runtime
     * refused the probe, so no score exists. It must never be ranked alongside
     * measured endpoints nor counted as a failure.
     */
    verdict: 'good' | 'usable' | 'poor' | 'dead' | 'unmeasurable';
    result: ProbeResult;
}

/** An address the panel could not measure, with the user-facing explanation. */
export interface UnmeasurableTarget {
    address: string;
    reason: ProbeBlockedReason;
    problem: string;
    impact: string;
    cause: string;
    solution: string;
}

export interface ScanRun {
    id: string;
    at: number;
    kind: ScanTargetKind;
    /** Scored targets, best first. */
    ranked: ScoredTarget[];
    /** Targets that failed every attempt are counted but not ranked. */
    dead: number;
    /**
     * Addresses the platform refused to probe, with explanations. Reported
     * separately from `dead` so the panel never tells a user that a healthy
     * Cloudflare IP is broken.
     */
    unmeasurable: UnmeasurableTarget[];
}

/** Persisted, size-bounded summary of a run. Full attempt lists are not kept. */
export interface ScanRunSummary {
    id: string;
    at: number;
    kind: ScanTargetKind;
    targets: number;
    healthy: number;
    /**
     * Candidates the platform refused to probe. Kept in the summary so a history
     * row can say "8 of 10 candidates were Cloudflare addresses we cannot measure
     * here" instead of implying they were tested and failed.
     */
    unmeasurable?: number;
    /**
     * Best target and its score, for trend display.
     *
     * `latencyMs` is present for device-side runs, where the measurement is a latency in
     * the first place. Optional because the Worker-side scanner records a score without
     * one, and because summaries written before v1.1 do not carry it.
     */
    best: { address: string; score: number; latencyMs?: number } | null;
    /** Median score across scored targets, or null when none scored. */
    medianScore: number | null;
}

/** Whether a scheduled scan is due, and why. */
export interface ScheduleDecision {
    due: boolean;
    reason: 'never-run' | 'interval-elapsed' | 'within-interval' | 'disabled';
    /** Epoch milliseconds of the next due time, or null when disabled. */
    nextDueAt: number | null;
}

export interface EndpointIntelligence {
    recommended: { address: string; score: number } | null;
    confidence: number;
    trend: 'unknown' | 'baseline' | 'improving' | 'stable' | 'degrading';
    scoreDelta: number | null;
    reasons: string[];
}

// Backup, health, deployment preflight, migration and endpoint lifecycle.
// These are contracts only: the behaviour lives in `src/features/*`, and the
// rule for this file (types only, no runtime values) still holds.

/** A settings value that can survive a JSON round trip. */
export type PortableValue = string | number | boolean | null | Array<string | number | boolean | null>;

/**
 * A backup document.
 *
 * Secrets are removed at export time, so this envelope is safe to store, email
 * or commit. `redactedKeys` records what was removed so a restore can tell the
 * operator which values they must re-enter rather than silently dropping them.
 */
export interface BackupEnvelope {
    /** Envelope schema version. Bumped only on breaking shape changes. */
    format: number;
    product: 'rayzen';
    /** Panel version that produced the backup. */
    panelVersion: string;
    /** Deployment kind that produced the backup, e.g. `worker` or `pages`. */
    deployType: string;
    createdAt: number;
    /** Secret or identity keys deliberately excluded from `settings`. */
    redactedKeys: string[];
    settings: Record<string, unknown>;
    /** Integrity checksum over every other field. */
    checksum: string;
}

export interface BackupValidation {
    /** False when the document cannot be honestly applied at all. */
    ok: boolean;
    /** User-facing findings, safe to display verbatim. */
    issues: string[];
    envelope: BackupEnvelope | null;
}

export interface RestoreChange {
    key: string;
    from: PortableValue;
    to: PortableValue;
}

export interface BackupPlan {
    /** Exactly what would change, computed without writing anything. */
    changes: RestoreChange[];
    /** Protected keys present in the file that will never be written. */
    refusedKeys: string[];
    /** Keys this panel version does not recognise, so cannot validate. */
    unknownKeys: string[];
    unchanged: number;
    requiresConfirmation: boolean;
    /** Patch to submit to the normal settings write path after confirmation. */
    patch: Record<string, unknown>;
}

/* Configuration comparison ------------------------------------------ */

export type DifferenceKind = 'added' | 'removed' | 'changed';

export interface ConfigDifference {
    key: string;
    kind: DifferenceKind;
    from: PortableValue;
    to: PortableValue;
    /** True when the key is protected and its values were withheld. */
    redacted: boolean;
}

export interface ConfigComparison {
    identical: boolean;
    differences: ConfigDifference[];
    summary: string;
}

/* Health Center ------------------------------------------------------ */

export type HealthStatus = 'good' | 'attention' | 'critical' | 'unknown';

export interface HealthSection {
    id: 'configuration' | 'endpoints' | 'system' | 'recommendations';
    title: string;
    status: HealthStatus;
    /** 0-100 where a score is meaningful, null where it is not. */
    score: number | null;
    /** One line the user can act on. */
    headline: string;
    details: string[];
}

export interface HealthCenterReport {
    status: HealthStatus;
    /** Weighted roll-up of the sections that produced a score. */
    score: number | null;
    /** The answer to "is my setup good?", in one sentence. */
    headline: string;
    sections: HealthSection[];
    /** Highest-value next actions, most important first. Never more than three. */
    nextActions: string[];
    at: number;
}

/* Deployment preflight ----------------------------------------------- */

export type PreflightStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface PreflightCheck {
    id: string;
    title: string;
    status: PreflightStatus;
    /** What was observed, in plain English. */
    message: string;
    /** What to do about it. Present whenever status is not `pass`. */
    fix?: string;
}

export interface PreflightReport {
    /** True when nothing blocking remains. Warnings do not block. */
    ready: boolean;
    checks: PreflightCheck[];
    blocking: number;
    warnings: number;
    at: number;
}

/* Update and migration framework ------------------------------------- */

export type VersionRelation = 'same' | 'upgrade' | 'downgrade' | 'unknown';

export interface MigrationStep {
    id: string;
    description: string;
    /** True when the panel performs it; false when the operator must act. */
    automatic: boolean;
}

export interface MigrationAssessment {
    from: string;
    to: string;
    relation: VersionRelation;
    /** False when the panel should refuse to proceed without operator action. */
    compatible: boolean;
    /** Findings the operator should read before continuing. */
    notes: string[];
    steps: MigrationStep[];
}

/* Endpoint lifecycle -------------------------------------------------- */

export type LifecycleState = 'new' | 'stable' | 'improving' | 'degrading' | 'retired';

export interface EndpointLifecycle {
    address: string;
    state: LifecycleState;
    /** Number of retained runs in which this address appeared as best. */
    observations: number;
    firstSeenAt: number;
    lastSeenAt: number;
    averageScore: number;
    /** Latest score minus the earliest retained score, or null when single-sample. */
    scoreDelta: number | null;
}

export interface MigrationAdvice {
    /** Address to move to, or null when staying put is correct. */
    moveTo: string | null;
    from: string | null;
    /** 0-1. Below the action threshold the panel only informs. */
    confidence: number;
    reasons: string[];
}

/* Recommendation effectiveness ---------------------------------------- */

export interface RecommendationEffectiveness {
    shown: number;
    accepted: number;
    dismissed: number;
    /** Accepted over answered, or null when nothing has been answered yet. */
    acceptanceRate: number | null;
    /** Shown but neither accepted nor dismissed. */
    pending: number;
    verdict: 'insufficient-data' | 'trusted' | 'mixed' | 'ignored';
    notes: string[];
}
